// Summarizes fixture-run output: per case read, how many trials matched the Vim expectation, the
// VSCodeVim expectation where the case has one, and which other states were seen. The last line,
// ROW, states the (a) grammar fixture row of issue #11 for the runs read: 100% of cases, in every
// trial the reported mode, pending keys, operator, count and register equal the case's expected
// state (the VSCodeVim value where the case records a documented deviation), at every delay and
// after vim.timeout for the cases that wait for it; a reset failure or an error is a trial that
// did not run, so the row then does not pass. The row also needs every case of spec/fixtures/grammar
// in the reads of every version, an end record in every file (a run that stopped early is not a
// row run), no S2_CASES selection, and one build over all files (lib.mjs buildInfo; files without
// a build count as the build "none").
// Usage: node spike/s2/harness/fixture-summary.mjs <run.jsonl>...
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./lib.mjs";

const fixtureDir = join(REPO, "spec/fixtures/grammar");
const fixtureCases = readdirSync(fixtureDir)
  .filter((n) => n.endsWith(".json"))
  .flatMap((n) =>
    JSON.parse(readFileSync(join(fixtureDir, n), "utf8")).cases.map(
      (c) => `${n.replace(".json", "")}/${c.id}`,
    ),
  );
const casesByVersion = new Map();
const files = [];

const groups = new Map();
const metas = [];
let resets = 0;
let errors = [];
let meta = [];
for (const file of process.argv.slice(2)) {
  const f = { file, meta: 0, end: 0, version: null };
  files.push(f);
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.type === "meta") {
      f.meta += 1;
      f.version = r.version;
    }
    if (r.type === "end") f.end += 1;
    if (r.type === "read") {
      const set = casesByVersion.get(f.version) ?? new Set();
      set.add(r.case);
      casesByVersion.set(f.version, set);
    }
    if (r.type === "meta") metas.push(r);
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

// The row. Every read group must hold one read per trial and delay of every run read.
const want = metas.reduce((n, m) => n + m.trials * m.delays.length, 0);
const cases = new Set([...groups.keys()].map((k) => k.split(" #")[0]));
const short = [...groups.values()].filter((g) => g.n !== want).length;
const mismatched = [...groups.values()].filter(
  (g) => (g.vscodevim ? g.engine : g.vim) !== g.n,
).length;
const label = [
  ...new Set(metas.map((m) => `${m.version} ${m.source} ${m.steps}`)),
].join(", ");
const missing = [...casesByVersion.entries()].flatMap(([v, set]) =>
  fixtureCases.filter((c) => !set.has(c)).map((c) => `${v} ${c}`),
);
const unfinished = files.filter((f) => f.meta !== 1 || f.end !== 1);
const selectedRuns = metas.filter((m) => m.only);
const builds = [...new Set(metas.map((m) => m.build?.id ?? "none"))];
const rowPass =
  metas.length > 0 &&
  groups.size > 0 &&
  short === 0 &&
  mismatched === 0 &&
  resets === 0 &&
  errors.length === 0 &&
  missing.length === 0 &&
  unfinished.length === 0 &&
  selectedRuns.length === 0 &&
  builds.length === 1;
if (missing.length)
  console.log(`cases missing (version case): ${missing.join(", ")}`);
for (const f of unfinished)
  console.log(
    `file without exactly one meta and one end record: ${f.file} (meta ${f.meta}, end ${f.end})`,
  );
console.log(
  `ROW (a) grammar fixture (${label}): ${cases.size} of ${fixtureCases.length} cases, ${groups.size} read points, ` +
    `${total} reads (want ${want} per read point; ${short} read points short), ` +
    `${mismatched} read points with a mismatch, reset failures ${resets}, errors ${errors.length}, ` +
    `missing cases ${missing.length}, unfinished files ${unfinished.length}, S2_CASES runs ${selectedRuns.length}, build ${builds.join("+")}: ` +
    `${rowPass ? "pass" : "not pass"}`,
);
