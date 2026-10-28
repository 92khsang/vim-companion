// The (a) polling CPU row of issue #11 from cpu.mjs records: per version and scenario, each window
// with the adapter on is compared with the mean of the 3 windows with it off: (CPU time on / wall
// time on) minus the mean of (CPU time off / wall time off) must be below 1% of one core, for every
// on window. The row needs, per version (1.134.0 and 1.141.0, both, as the issue states them):
// - exactly 3 valid 10-minute windows per arm and scenario (cpu.mjs `valid`);
// - no window that failed for a reason other than a rerunnable one: another sandbox on the cores or
//   load from elsewhere on them (cpu.mjs `rerunnable`), or an error before the probe's first hello
//   with the adapter off (the summary decides this from the record's phase and arm, not from the
//   record's flag); an adapter check, the polling, the typing evidence, the input check, an error
//   after the probe's hello, or any error with the adapter on (the adapter is loaded before that
//   hello) fails the row;
// - VS Code of the version label in every window (hello.vscode) and one VSCodeVim and one which-key
//   version over the version's windows, none of them missing;
// - one build without uncommitted changes over all records.
// The ROW line lists every window that was not counted, per arm, with its reason, and, per arm over
// the counted windows of both scenarios, the maximum of the load from elsewhere on the cores, of
// the busy share of a Hyper-Threading pair, and of the busy share of the pairs' cores outside
// S2_CPUS.
// Usage: node spike/s2/batch/cpu-summary.mjs <cpu-<version>.jsonl>...
import { readFileSync } from "node:fs";

const VERSIONS = ["1.134.0", "1.141.0"];
const recs = process.argv
  .slice(2)
  .flatMap((f) =>
    readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse),
  );
const frac = (r) => r.cpuMs / r.wallMs;
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(3)}%` : "-");
const max = (xs) => (xs.length ? Math.max(...xs) : NaN);
const builds = [...new Set(recs.map((r) => r.build?.id ?? "none"))];
const dirty = recs.filter((r) => !r.build || r.build.dirty?.length);
console.log(
  `builds: ${builds.join(", ")}${builds.length > 1 ? " (mixed: the row does not pass)" : ""}` +
    (dirty.length
      ? `; ${dirty.length} records without a build or of a build with uncommitted changes`
      : ""),
);
const why = (r) =>
  r.error
    ? `error in the phase ${r.phase ?? "unknown"}: ${r.error}`
    : r.valid === true
      ? `window of ${r.minutes} min (${r.wallMs} ms)`
      : (r.invalid ?? ["no validity record"]).join("; ");
// Whether a record that was not counted may be run again; anything else fails the row.
const rerunnable = (r) =>
  r.error
    ? r.phase === "boot" && r.arm === "off"
    : r.valid !== true && r.rerunnable === true;
const isCounted = (r) =>
  r.valid === true && r.minutes === 10 && r.wallMs >= 600000;
const loads = (ws) =>
  `outside load max ${pct(max(ws.map((r) => r.cores.foreignShare)))}, ` +
  `HT pair busy max ${pct(max(ws.flatMap((r) => r.cores.pairs.map((p) => p.busyShare))))}, ` +
  `pair cores outside the set max ${pct(max(ws.map((r) => r.cores.siblingsOutside.busyShare)))}`;
let allPass = builds.length === 1 && dirty.length === 0;
for (const version of VERSIONS) {
  const vRecs = recs.filter((r) => r.version === version);
  let pass = builds.length === 1 && dirty.length === 0 && vRecs.length > 0;
  const withHello = vRecs.filter((r) => r.hello);
  const wrongCode = withHello.filter((r) => r.hello.vscode !== version);
  const vims = [
    ...new Set(withHello.map((r) => r.hello.vim?.version ?? "none")),
  ];
  const wks = [
    ...new Set(withHello.map((r) => r.hello.whichkey?.version ?? "none")),
  ];
  if (
    wrongCode.length ||
    vims.length !== 1 ||
    wks.length !== 1 ||
    vims[0] === "none" ||
    wks[0] === "none"
  )
    pass = false;
  const notes = [];
  for (const scenario of ["idle", "typing"]) {
    const sel = (arm, f) =>
      vRecs.filter((r) => r.scenario === scenario && r.arm === arm && f(r));
    const offW = sel("off", isCounted);
    const onW = sel("on", isCounted);
    if (offW.length !== 3 || onW.length !== 3) pass = false;
    for (const arm of ["off", "on"]) {
      for (const r of sel(arm, (x) => !isCounted(x) && rerunnable(x)))
        notes.push(`${scenario} ${arm} dropped (rerun): ${why(r)}`);
      for (const r of sel(arm, (x) => !isCounted(x) && !rerunnable(x))) {
        notes.push(`${scenario} ${arm} FAILED: ${why(r)}`);
        pass = false;
      }
    }
    const meanOff = offW.length
      ? offW.reduce((s, r) => s + frac(r), 0) / offW.length
      : NaN;
    const diffs = onW.map((r) => frac(r) - meanOff);
    if (!(diffs.length === 3 && diffs.every((d) => d < 0.01))) pass = false;
    console.log(
      `${version} ${scenario}: off windows ${offW.length} (${offW.map((r) => pct(frac(r))).join(", ")}; mean ${pct(meanOff)}), ` +
        `on windows ${onW.length} (${onW.map((r) => pct(frac(r))).join(", ")}); ` +
        `on minus mean off: ${diffs.map(pct).join(", ")} (threshold 1.000% of one core)`,
    );
  }
  const perArm = (arm) => {
    const ws = vRecs.filter((r) => r.arm === arm && isCounted(r));
    return ws.length ? loads(ws) : "no counted windows";
  };
  console.log(
    `ROW (a) polling CPU ${version}: VS Code ${[...new Set(withHello.map((r) => r.hello.vscode))].join("+") || "none"}${wrongCode.length ? ` (${wrongCode.length} windows not ${version})` : ""}, ` +
      `VSCodeVim ${vims.join("+") || "none"}, which-key ${wks.join("+") || "none"}, build ${builds.join("+")}${dirty.length ? " (not clean)" : ""}; ` +
      `off: ${perArm("off")}; on: ${perArm("on")}; ` +
      `windows not counted: ${notes.length ? notes.join(" | ") : "none"}: ${pass ? "pass" : "not pass"}`,
  );
  allPass &&= pass;
}
console.log(
  `ROW (a) polling CPU, both versions (${VERSIONS.join(", ")}), build ${builds.join("+")}: ${allPass ? "pass" : "not pass"}`,
);
