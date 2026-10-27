// The (a) polling CPU row of issue #11 from cpu.mjs records: per version and scenario, each window
// with the adapter on is compared with the mean of the 3 windows with it off: (CPU time on / wall
// time on) minus the mean of (CPU time off / wall time off) must be below 1% of one core, for every
// on window. Only valid windows count (cpu.mjs `valid`: the input check, the adapter check, the
// typing evidence and the load from elsewhere on the S2_CPUS cores); a record with an error or an
// invalid window is a window that did not run. The row needs exactly 3 valid windows per arm,
// scenario and version, both versions of the issue (1.134.0 and 1.141.0, or S2_BATCH_VERSIONS),
// one build over all records (records without a build count as the build "none"), and windows of
// 10 minutes, as the row states.
// Usage: node spike/s2/batch/cpu-summary.mjs <cpu-<version>.jsonl>...
import { readFileSync } from "node:fs";

const recs = process.argv
  .slice(2)
  .flatMap((f) =>
    readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse),
  );
const expected = (process.env.S2_BATCH_VERSIONS ?? "1.134.0 1.141.0")
  .split(/\s+/)
  .filter(Boolean)
  .sort();
const ok = recs.filter((r) => r.valid === true);
const notRun = recs.filter((r) => r.valid !== true);
const short = ok.filter((r) => r.minutes !== 10 || r.wallMs < 600000);
const frac = (r) => r.cpuMs / r.wallMs;
const pct = (x) => `${(x * 100).toFixed(3)}%`;
const builds = [...new Set(recs.map((r) => r.build?.id ?? "none"))];
const versions = [...new Set(recs.map((r) => r.version))].sort();
console.log(
  `builds: ${builds.join(", ")}${builds.length > 1 ? " (mixed: the row does not pass)" : ""}`,
);
let allPass = builds.length === 1 && short.length === 0;
if (short.length)
  console.log(
    `windows shorter than 10 minutes: ${short.length} (the row does not pass)`,
  );
for (const version of versions) {
  let pass = builds.length === 1;
  for (const scenario of ["idle", "typing"]) {
    const sel = (arm) =>
      ok.filter(
        (r) =>
          r.version === version && r.scenario === scenario && r.arm === arm,
      );
    const offW = sel("off");
    const onW = sel("on");
    const bad = notRun.filter(
      (r) => r.version === version && r.scenario === scenario,
    );
    if (offW.length !== 3 || onW.length !== 3) pass = false;
    const meanOff = offW.length
      ? offW.reduce((s, r) => s + frac(r), 0) / offW.length
      : NaN;
    const diffs = onW.map((r) => frac(r) - meanOff);
    if (!diffs.every((d) => d < 0.01)) pass = false;
    const foreign = [...offW, ...onW].map((r) => pct(r.cores.foreignShare));
    console.log(
      `${version} ${scenario}: off windows ${offW.length} (${offW.map((r) => pct(frac(r))).join(", ")}; mean ${pct(meanOff)}), ` +
        `on windows ${onW.length} (${onW.map((r) => pct(frac(r))).join(", ")}), not run or invalid ${bad.length}; ` +
        `on minus mean off: ${diffs.map(pct).join(", ")} (threshold 1.000% of one core); ` +
        `load from elsewhere on the cores, per window: ${foreign.join(", ")}`,
    );
    for (const r of bad)
      console.log(
        `  not counted: ${r.arm} ${r.error ? `error (${r.phase ?? "no phase"}): ${r.error}` : (r.invalid ?? ["no validity record"]).join("; ")}`,
      );
  }
  console.log(`ROW (a) polling CPU ${version}: ${pass ? "pass" : "not pass"}`);
  allPass &&= pass;
}
const missing = expected.filter((v) => !versions.includes(v));
if (missing.length) allPass = false;
console.log(
  `ROW (a) polling CPU, both versions (${expected.join(", ")}${missing.length ? `; missing ${missing.join(", ")}` : ""}), build ${builds.join("+")}: ${allPass ? "pass" : "not pass"}`,
);
