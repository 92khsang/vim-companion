// Compares differential runs: the runs with the adapter off must all agree; each run with the
// adapter on is compared with them. Editor URIs are reduced to file names, since every run has its
// own sandbox directory.
// Usage: node spike/s2/harness/differential-compare.mjs <runs.jsonl>...
import { readFileSync } from "node:fs";

const norm = (snap) =>
  JSON.stringify({
    active: snap.active?.replace(/^.*\//, "") ?? null,
    editors: snap.editors
      .map((e) => ({
        file: e.uri.replace(/^.*\//, ""),
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
