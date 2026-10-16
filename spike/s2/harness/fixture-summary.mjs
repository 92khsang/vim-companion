// Summarizes fixture-run output: per case read, how many trials matched the Vim expectation, the
// VSCodeVim expectation where the case has one, and which other states were seen.
// Usage: node spike/s2/harness/fixture-summary.mjs <run.jsonl>...
import { readFileSync } from "node:fs";

const groups = new Map();
let resets = 0;
let errors = [];
let meta = [];
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.type === "meta")
      meta.push(
        `${r.version} ${r.source} trials=${r.trials} delays=${r.delays} steps=${r.steps} poll=${r.poll}`,
      );
    if (r.type === "reset-failed") resets += 1;
    if (r.type === "error") errors.push(r.error.split("\n")[0]);
    if (r.type !== "read") continue;
    const key = `${r.case} #${r.k} ${r.at}`;
    const g = groups.get(key) ?? {
      n: 0,
      vim: 0,
      engine: 0,
      seen: new Map(),
      expect: r.expect,
      vscodevim: r.vscodevim,
      keys: r.keys.join(" "),
    };
    g.n += 1;
    const s = JSON.stringify(r.state);
    if (s === JSON.stringify(r.expect)) g.vim += 1;
    if (r.vscodevim && s === JSON.stringify(r.vscodevim)) g.engine += 1;
    g.seen.set(s, (g.seen.get(s) ?? 0) + 1);
    groups.set(key, g);
  }
}
console.log(meta.join("\n"));
console.log(
  `reset failures: ${resets}; errors: ${errors.length} ${errors.join(" | ")}`,
);
let total = 0,
  pass = 0;
for (const [key, g] of groups) {
  const target = g.vscodevim ? g.engine : g.vim;
  total += g.n;
  pass += target;
  const mark = target === g.n ? "ok  " : "DIFF";
  const others = [...g.seen]
    .filter(([s]) => s !== JSON.stringify(g.vscodevim ?? g.expect))
    .map(([s, n]) => `${n}x ${s}`);
  console.log(
    `${mark} ${key} [${g.keys}] ${target}/${g.n}${g.vscodevim ? " (vscodevim value)" : ""}${others.length ? " other: " + others.join("; ") : ""}`,
  );
}
console.log(`${pass}/${total} reads matched the expected value`);
