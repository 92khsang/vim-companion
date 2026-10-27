// Compares differential runs: the runs with the adapter off must all agree; each run with the
// adapter on is compared with them. Editor URIs are reduced to file names, since every run has its
// own sandbox directory. Per version, the report counts the majority and minority adapter-off
// outcomes and names, for each minority run, the first item at which it parts from the majority:
// from the trace digests (S2_DIFF_TRACE=1 records) when the runs carry a trace, otherwise from the
// final snapshot fields that differ. Runs with a settle rule (`settle` in the record) get a wait
// summary per rule. Last, per version, one ROW line states the differential row's pass condition
// as issue #11 writes it: the adapter-off runs all agree, and 0 adapter-on runs differ from them;
// comparisons stay within one version. With S2_DIFF_EXPECT=<n>, the row also needs n completed runs
// per arm and version. The row also needs, per version:
// - run-errors only of the phase `start` (a run that measured nothing, which a batch replaces with
//   a further run); an error while the script was typed or read counts against the row (on the
//   adapter-on arm it is a run that did not behave as with the adapter off; on the adapter-off arm
//   it is non-determinism), and so does an error without a phase;
// - run numbers that are unique and contiguous from 0 over runs and run-errors, and, when both arms
//   are present, strict alternation: every even run on one arm, every odd run on the other;
// - an adapter check in every adapter-on run that shows a working adapter (adapterCheck.ok), and no
//   adapter in every adapter-off run;
// - no trace run (S2_DIFF_TRACE: a diagnostic, its reads lengthen the gaps between items);
// - one build: every record of all the files read carries the same build id (records without a
//   build count as the build "none").
// Usage: node spike/s2/harness/differential-compare.mjs <runs.jsonl>...
import { readFileSync } from "node:fs";

const file = (uri) => uri?.replace(/^.*\//, "") ?? null;
const norm = (snap) =>
  JSON.stringify({
    active: file(snap.active),
    activeViewColumn: snap.activeViewColumn,
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
  const settledAll = vOff.filter((r) => r.settle);
  const rules = [...new Set(settledAll.map((r) => r.settle.rule ?? "hidden"))];
  for (const rule of rules) {
    const settled = settledAll.filter(
      (r) => (r.settle.rule ?? "hidden") === rule,
    );
    if (rule === "effect") {
      effectSummary(settled, "adapter-off");
      const onSettled = on.filter(
        (r) => r.version === version && r.settle?.rule === "effect",
      );
      if (onSettled.length) effectSummary(onSettled, "adapter-on");
      continue;
    }
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

function effectSummary(settled, arm) {
  const mean = (xs) =>
    xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-";
  const range = (xs) =>
    xs.length
      ? `mean ${mean(xs)} min ${Math.min(...xs)} max ${Math.max(...xs)}`
      : "-";
  const waits = settled.flatMap((r) => r.settle.waits);
  console.log(
    `  settle effect rule (${settled.length} ${arm} runs, cap ${settled[0].settle.capMs} ms): ` +
      `waits per run ${[...new Set(settled.map((r) => r.settle.count))].join("/")}`,
  );
  const byKey = new Map();
  for (const w of waits) {
    const k = `${w.item} ${w.path} (${w.command})`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)).push(w);
  }
  for (const [k, ws] of byKey) {
    const kinds = [...new Set(ws.map((w) => `${w.from} -> ${w.observed}`))];
    const ev = ws.map((w) => w.eventAfterLeafMs).filter((x) => x !== null);
    console.log(
      `    ${k}: ${ws.length} waits; ${kinds.join(", ")}; wait ms ${range(ws.map((w) => w.waitMs))}; ` +
        `polls ${range(ws.map((w) => w.polls))}; effect ms after the earliest leaf time ${range(ev)}; ` +
        `quick input visible when the wait ended ${ws.filter((w) => w.quickVisible).length}, ` +
        `focus in it ${ws.filter((w) => w.focusInQuick).length}` +
        (ws.some((w) => w.untilNextKeyMs !== undefined)
          ? `; no change until the next key in ${ws.filter((w) => w.changesUntilNextKey === 0).length} of ${ws.filter((w) => w.untilNextKeyMs !== undefined).length} (ms to the next key ${range(ws.filter((w) => w.untilNextKeyMs !== undefined).map((w) => w.untilNextKeyMs))})`
          : ""),
    );
  }
}

// ---------- the row, per version ----------

const expectRuns = process.env.S2_DIFF_EXPECT
  ? Number(process.env.S2_DIFF_EXPECT)
  : undefined;
const allVersions = [
  ...new Set([...ok, ...errors].map((r) => r.version)),
].sort();
const builds = [...new Set(runs.map((r) => r.build?.id ?? "none"))];
console.log(
  `builds: ${builds.join(", ")}${builds.length > 1 ? " (mixed: the row does not pass)" : ""}`,
);
for (const version of allVersions) {
  const vOff = off.filter((r) => r.version === version);
  const vOn = on.filter((r) => r.version === version);
  const vErr = errors.filter((r) => r.version === version);
  const fatal = vErr.filter((r) => r.phase !== "start");
  const outcomes = new Set(vOff.map(key));
  const vKey = mostCommon(vOff.map(key));
  const differ = vOn.filter((r) => key(r) !== vKey);
  const complete =
    expectRuns === undefined ||
    (vOn.length >= expectRuns && vOff.length >= expectRuns);
  // Run numbers over runs and run-errors: unique, contiguous from 0, and alternating arms.
  const all = [...vOn, ...vOff, ...vErr];
  const nums = all.map((r) => r.i).sort((a, b) => a - b);
  const unique = new Set(nums).size === nums.length;
  const contiguous = nums.every((n, j) => n === j);
  const both = vOn.length > 0 && vOff.length > 0;
  const parityArm = (p) => [
    ...new Set(all.filter((r) => r.i % 2 === p).map((r) => r.arm)),
  ];
  const even = parityArm(0);
  const odd = parityArm(1);
  const alternating =
    !both || (even.length === 1 && odd.length === 1 && even[0] !== odd[0]);
  const onBad = vOn.filter((r) => r.adapterCheck?.ok !== true);
  const offBad = vOff.filter(
    (r) =>
      (r.hello?.adapter ?? r.adapter) != null ||
      r.adapterCheck?.present === true,
  );
  const traced = [...vOn, ...vOff].filter((r) => r.trace);
  const pass =
    vOff.length > 0 &&
    vOn.length > 0 &&
    outcomes.size === 1 &&
    differ.length === 0 &&
    fatal.length === 0 &&
    complete &&
    unique &&
    contiguous &&
    alternating &&
    onBad.length === 0 &&
    offBad.length === 0 &&
    traced.length === 0 &&
    builds.length === 1;
  console.log(
    `ROW differential ${version}: ${vOn.length} on, ${vOff.length} off` +
      (expectRuns === undefined ? "" : ` (need ${expectRuns} each)`) +
      `, run errors ${vErr.length} (start ${vErr.length - fatal.length}, script or read ${fatal.length}; on ${vErr.filter((r) => r.arm === "on").length}, off ${vErr.filter((r) => r.arm === "off").length})` +
      `, adapter-off outcomes ${outcomes.size}, adapter-on runs that differ ${differ.length}` +
      `, run numbers ${unique && contiguous ? `0-${nums.length - 1}` : "not unique and contiguous"}${both ? (alternating ? ", alternating" : ", NOT alternating") : ""}` +
      `, adapter checks failed ${onBad.length} on, ${offBad.length} off` +
      (traced.length ? `, trace runs ${traced.length}` : "") +
      `, build ${builds.join("+")}` +
      `: ${pass ? "pass" : "not pass"}` +
      (differ.length ? ` (runs ${differ.map((r) => r.i).join(", ")})` : "") +
      (fatal.length
        ? ` (errors in runs ${fatal.map((r) => `${r.i} ${r.phase ?? "no phase"}`).join(", ")})`
        : "") +
      (onBad.length
        ? ` (adapter: ${[...new Set(onBad.map((r) => (r.adapterCheck?.reasons ?? ["no adapter check"]).join("; ")))].join(" | ")})`
        : ""),
  );
}
