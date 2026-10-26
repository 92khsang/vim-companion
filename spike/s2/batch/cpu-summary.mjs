// The (a) polling CPU row of issue #11 from cpu.mjs records: per version and scenario, each window
// with the adapter on is compared with the mean of the 3 windows with it off: (CPU time on / wall
// time on) minus the mean of (CPU time off / wall time off) must be below 1% of one core, for every
// on window. A record with an error is a window that did not run.
// Usage: node spike/s2/batch/cpu-summary.mjs <cpu-<version>.jsonl>...
import { readFileSync } from "node:fs";

const recs = process.argv
  .slice(2)
  .flatMap((f) =>
    readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse),
  );
const errors = recs.filter((r) => r.error);
const ok = recs.filter((r) => !r.error);
const frac = (r) => r.cpuMs / r.wallMs;
const pct = (x) => `${(x * 100).toFixed(3)}%`;
const versions = [...new Set(recs.map((r) => r.version))].sort();
let allPass = versions.length > 0;
for (const version of versions) {
  let pass = true;
  for (const scenario of ["idle", "typing"]) {
    const offW = ok.filter(
      (r) =>
        r.version === version && r.scenario === scenario && r.arm === "off",
    );
    const onW = ok.filter(
      (r) => r.version === version && r.scenario === scenario && r.arm === "on",
    );
    const errs = errors.filter(
      (r) => r.version === version && r.scenario === scenario,
    ).length;
    if (offW.length !== 3 || onW.length !== 3) pass = false;
    const meanOff = offW.length
      ? offW.reduce((s, r) => s + frac(r), 0) / offW.length
      : NaN;
    const diffs = onW.map((r) => frac(r) - meanOff);
    if (!diffs.every((d) => d < 0.01)) pass = false;
    console.log(
      `${version} ${scenario}: off windows ${offW.length} (${offW.map((r) => pct(frac(r))).join(", ")}; mean ${pct(meanOff)}), ` +
        `on windows ${onW.length} (${onW.map((r) => pct(frac(r))).join(", ")}), errors ${errs}; ` +
        `on minus mean off: ${diffs.map(pct).join(", ")} (threshold 1.000% of one core)`,
    );
  }
  console.log(`ROW (a) polling CPU ${version}: ${pass ? "pass" : "not pass"}`);
  allPass &&= pass;
}
console.log(
  `ROW (a) polling CPU, both versions: ${allPass ? "pass" : "not pass"}`,
);
