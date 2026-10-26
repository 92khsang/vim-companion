// Compares differential runs: the runs with the adapter off must all agree; each run with the
// adapter on is compared with them. Editor URIs are reduced to file names, since every run has its
// own sandbox directory. Per version, the report counts the majority and minority adapter-off
// outcomes and names, for each minority run, the first item at which it parts from the majority:
// from the trace digests (S2_DIFF_TRACE=1 records) when the runs carry a trace, otherwise from the
// final snapshot fields that differ. Runs with the settle rule (`settle` in the record) get a wait
// summary.
// Usage: node spike/s2/harness/differential-compare.mjs <runs.jsonl>...
import { readFileSync } from "node:fs";

const file = (uri) => uri?.replace(/^.*\//, "") ?? null;
const norm = (snap) =>
  JSON.stringify({
    active: file(snap.active),
    editors: snap.editors
      .map((e) => ({
        file: file(e.uri),
        viewColumn: e.viewColumn,
        text: e.text,
        selections: e.selections,
      }))
      .sort(
        (a, b) => a.file.localeCompare(b.file) || a.viewColumn - b.viewColumn,
      ),
  });
const key = (r) =>
  `${norm(r.end)}\n${norm(r.pasted)}\n${JSON.stringify(r.clipboard)}`;
const runs = process.argv.slice(2).flatMap((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l)),
);
const errors = runs.filter((r) => r.type === "run-error");
const ok = runs.filter((r) => r.type === "run");
const off = ok.filter((r) => r.arm === "off");
const on = ok.filter((r) => r.arm === "on");
const offKeys = new Map();
for (const r of off) offKeys.set(key(r), (offKeys.get(key(r)) ?? 0) + 1);
const [refKey] = [...offKeys.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
const onDiff = on.filter((r) => key(r) !== refKey);
console.log(
  `runs: ${ok.length} (${on.length} on, ${off.length} off), errors: ${errors.length}`,
);
console.log(
  `adapter-off outcomes: ${offKeys.size} distinct (${[...offKeys.values()].join(", ")} runs)`,
);
console.log(
  `adapter-on runs that differ from the adapter-off outcome: ${onDiff.length}`,
);
for (const e of errors.slice(0, 5))
  console.log(`error run ${e.i} ${e.arm}: ${e.error}`);

// ---------- per version: majority, minority and where a minority run parts ----------

const mostCommon = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
// The trace digest of an item leaves out the events, whose delays vary from run to run.
const digest = (t) =>
  JSON.stringify({ editor: t.editor, registers: t.registers });
// The final snapshot as flat fields, for the report of a run without a trace.
const fields = (r) => {
  const out = {
    "end.active": `${file(r.end.active)}:${r.end.activeViewColumn}`,
  };
  for (const [name, snap] of [
    ["end", r.end],
    ["pasted", r.pasted],
  ]) {
    for (const e of snap.editors) {
      out[`${name}.${file(e.uri)}:${e.viewColumn}.text`] = e.text;
      out[`${name}.${file(e.uri)}:${e.viewColumn}.selections`] = JSON.stringify(
        e.selections,
      );
    }
  }
  out.clipboard = JSON.stringify(r.clipboard);
  return out;
};
const short = (v) => {
  const s = String(v);
  return s.length > 40 ? `${s.length} chars` : JSON.stringify(s);
};
const firstDifference = (run, majority) => {
  if (run.trace && majority.every((m) => m.trace)) {
    for (let j = 0; j < run.trace.length; j++) {
      const ref = mostCommon(majority.map((m) => digest(m.trace[j])));
      if (digest(run.trace[j]) === ref) continue;
      const refTrace = JSON.parse(ref);
      const t = run.trace[j];
      const parts = [];
      if (t.editor !== refTrace.editor)
        parts.push(`editor ${t.editor} vs ${refTrace.editor}`);
      const regs = new Set([
        ...Object.keys(t.registers),
        ...Object.keys(refTrace.registers),
      ]);
      for (const name of [...regs].sort())
        if (t.registers[name] !== refTrace.registers[name])
          parts.push(
            `register ${name} ${short(t.registers[name])} vs ${short(refTrace.registers[name])}`,
          );
      return `parts at item ${j} (${t.item}): ${parts.join("; ")}`;
    }
    return "trace agrees with the majority at every item";
  }
  const f = fields(run);
  const g = fields(majority[0]);
  const diffs = Object.keys(f)
    .filter((k) => f[k] !== g[k])
    .map((k) => `${k} ${short(f[k])} vs ${short(g[k])}`);
  return `no trace; final fields that differ: ${diffs.join("; ")}`;
};

const versions = [...new Set(off.map((r) => r.version))].sort();
for (const version of versions) {
  const vOff = off.filter((r) => r.version === version);
  const vKey = mostCommon(vOff.map(key));
  const majority = vOff.filter((r) => key(r) === vKey);
  const minority = vOff.filter((r) => key(r) !== vKey);
  console.log(
    `version ${version}: adapter-off majority ${majority.length} of ${vOff.length}, minority ${minority.length}` +
      (refKey !== undefined && vKey !== refKey
        ? " (its majority differs from the overall majority)"
        : ""),
  );
  for (const r of minority)
    console.log(`  minority run ${r.i}: ${firstDifference(r, majority)}`);
  const settled = vOff.filter((r) => r.settle);
  if (settled.length) {
    const waits = settled.flatMap((r) => r.settle.waits);
    const ms = waits.map((w) => w.waitMs);
    const mean = (xs) =>
      xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-";
    console.log(
      `  settle (${settled.length} runs, cap ${settled[0].settle.capMs} ms): ` +
        `waits per run ${[...new Set(settled.map((r) => r.settle.count))].join("/")}, ` +
        `wait ms mean ${mean(ms)} min ${Math.min(...ms)} max ${Math.max(...ms)}, ` +
        `capped ${waits.filter((w) => !w.hidden).length}, ` +
        `visible at first poll ${waits.filter((w) => w.visibleAtFirstPoll).length} of ${waits.length}, ` +
        `closing at first poll ${waits.filter((w) => w.closingAtFirstPoll).length}, ` +
        `focus still in the quick input at first poll ${waits.filter((w) => w.focusInQuickAtFirstPoll).length}`,
    );
    const byKey = new Map();
    for (const w of waits)
      (
        byKey.get(`${w.item} ${w.path}`) ??
        byKey.set(`${w.item} ${w.path}`, []).get(`${w.item} ${w.path}`)
      ).push(w.waitMs);
    for (const [k, xs] of byKey)
      console.log(
        `    ${k}: ${xs.length} waits, mean ${mean(xs)} ms, min ${Math.min(...xs)}, max ${Math.max(...xs)}`,
      );
  }
}
