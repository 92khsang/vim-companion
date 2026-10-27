// Summarizes fixture-run output: per version and case read, how many trials matched the Vim
// expectation, the VSCodeVim expectation where the case has one, and which other states were seen.
// The last line, ROW, states the (a) grammar fixture row of issue #11 for the runs read: 100% of
// cases, in every trial the reported mode, pending keys, operator, count and register equal the
// case's expected state (the VSCodeVim value where the case records a documented deviation), at
// every delay and after vim.timeout for the cases that wait for it. The row needs:
// - per version, one complete run (one meta and one end record) of the adapter with 10 trials at
//   10, 30 and 60 ms, reads after the last key (`last`), no S2_CASES selection, every case of
//   spec/fixtures/grammar, and every read point read trials x delays times;
// - every read of every file to match, including the files of runs that stopped early: such an
//   incomplete file (no end record) counts only when it holds no mismatched read, no reset failure
//   and no error; a reset failure or an error anywhere fails the row;
// - every read at most 50 ms later than the row states (100 ms plus one poll interval after the
//   last key, and that plus vim.timeout for the read after the timeout; readAfterMs);
// - one poll interval: the meta's poll equals the adapter's own (adapterPollMs);
// - VS Code of the version label (hello.vscode) and one VSCodeVim and one which-key version per
//   version, and one build without uncommitted changes over all files.
// Usage: node spike/s2/harness/fixture-summary.mjs <run.jsonl>...
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./lib.mjs";

const TIMEOUT = 1000;
const LATE_MS = 50;
const fixtureDir = join(REPO, "spec/fixtures/grammar");
const fixtureCases = readdirSync(fixtureDir)
  .filter((n) => n.endsWith(".json"))
  .flatMap((n) =>
    JSON.parse(readFileSync(join(fixtureDir, n), "utf8")).cases.map(
      (c) => `${n.replace(".json", "")}/${c.id}`,
    ),
  );

const files = [];
for (const file of process.argv.slice(2)) {
  const recs = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const metas = recs.filter((r) => r.type === "meta");
  files.push({
    file,
    meta: metas[0],
    metaCount: metas.length,
    ends: recs.filter((r) => r.type === "end").length,
    reads: recs.filter((r) => r.type === "read"),
    resets: recs.filter((r) => r.type === "reset-failed").length,
    errors: recs
      .filter((r) => r.type === "error")
      .map((r) => r.error.split("\n")[0]),
  });
}
for (const f of files) {
  f.version = f.meta?.version ?? null;
  f.complete = f.metaCount === 1 && f.ends === 1;
  const settle = 100 + (f.meta?.poll ?? 0);
  f.mismatches = f.reads.filter(
    (r) => JSON.stringify(r.state) !== JSON.stringify(r.vscodevim ?? r.expect),
  ).length;
  f.late = f.reads.filter(
    (r) =>
      !(
        r.readAfterMs >= 0 &&
        r.readAfterMs <= (r.at === "timeout" ? TIMEOUT : 0) + settle + LATE_MS
      ),
  ).length;
  f.maxRead = {
    key: Math.max(
      -1,
      ...f.reads.filter((r) => r.at === "key").map((r) => r.readAfterMs ?? -1),
    ),
    timeout: Math.max(
      -1,
      ...f.reads
        .filter((r) => r.at === "timeout")
        .map((r) => r.readAfterMs ?? -1),
    ),
  };
  console.log(
    `${f.file.replace(/^.*\//, "")}: ${f.meta ? `${f.meta.version} ${f.meta.source} trials=${f.meta.trials} delays=${f.meta.delays} steps=${f.meta.steps} poll=${f.meta.poll} adapterPollMs=${f.meta.adapterPollMs ?? "-"}` : "no meta"}, ` +
      `${f.complete ? "complete" : "INCOMPLETE"}, ${f.reads.length} reads, ${f.mismatches} mismatched, reset failures ${f.resets}, errors ${f.errors.length}${f.errors.length ? ` (${f.errors.join(" | ")})` : ""}, ` +
      `latest read after the last key ${f.maxRead.key} ms (timeout reads ${f.maxRead.timeout} ms), late ${f.late}`,
  );
}

// Per read point and version over all files: counts and the states seen.
const groups = new Map();
for (const f of files)
  for (const r of f.reads) {
    const key = `${f.version} ${r.case} #${r.k} ${r.at}`;
    const g = groups.get(key) ?? {
      version: f.version,
      case: r.case,
      n: 0,
      nComplete: 0,
      vim: 0,
      engine: 0,
      seen: new Map(),
      expect: r.expect,
      vscodevim: r.vscodevim,
      keys: r.keys.join(" "),
    };
    g.n += 1;
    if (f.complete) g.nComplete += 1;
    const s = JSON.stringify(r.state);
    if (s === JSON.stringify(r.expect)) g.vim += 1;
    if (r.vscodevim && s === JSON.stringify(r.vscodevim)) g.engine += 1;
    g.seen.set(s, (g.seen.get(s) ?? 0) + 1);
    groups.set(key, g);
  }
let total = 0;
let pass = 0;
for (const [key, g] of groups) {
  const target = g.vscodevim ? g.engine : g.vim;
  total += g.n;
  pass += target;
  const others = [...g.seen]
    .filter(([s]) => s !== JSON.stringify(g.vscodevim ?? g.expect))
    .map(([s, n]) => `${n}x ${s}`);
  console.log(
    `${target === g.n ? "ok  " : "DIFF"} ${key} [${g.keys}] ${target}/${g.n}${g.vscodevim ? " (vscodevim value)" : ""}${others.length ? " other: " + others.join("; ") : ""}`,
  );
}
console.log(`${pass}/${total} reads matched the expected value`);

// The row.
const versions = [...new Set(files.map((f) => f.version))].sort();
const metas = files.map((f) => f.meta).filter(Boolean);
const builds = [...new Set(metas.map((m) => m.build?.id ?? "none"))];
const dirty = metas.filter((m) => !m.build || m.build.dirty?.length);
const problems = [];
if (builds.length !== 1) problems.push(`builds ${builds.join("+")}`);
if (dirty.length) problems.push("a build that is not clean");
for (const f of files) {
  if (f.metaCount !== 1)
    problems.push(`${f.file}: ${f.metaCount} meta records`);
  if (f.resets) problems.push(`${f.file}: reset failures ${f.resets}`);
  if (f.errors.length) problems.push(`${f.file}: errors ${f.errors.length}`);
  if (f.mismatches)
    problems.push(`${f.file}: ${f.mismatches} mismatched reads`);
  if (f.late) problems.push(`${f.file}: ${f.late} late reads`);
}
for (const v of versions) {
  const vFiles = files.filter((f) => f.version === v);
  const complete = vFiles.filter((f) => f.complete);
  if (complete.length !== 1) {
    problems.push(`${v}: ${complete.length} complete runs`);
    continue;
  }
  const m = complete[0].meta;
  if (
    m.source !== "adapter" ||
    m.steps !== "last" ||
    m.trials !== 10 ||
    JSON.stringify(m.delays) !== "[10,30,60]" ||
    m.only
  )
    problems.push(
      `${v}: the complete run is not the row's (source ${m.source}, steps ${m.steps}, trials ${m.trials}, delays ${m.delays}, S2_CASES ${m.only ?? "none"})`,
    );
  if (m.poll !== m.adapterPollMs)
    problems.push(
      `${v}: poll ${m.poll} is not the adapter's ${m.adapterPollMs}`,
    );
  const want = m.trials * m.delays.length;
  const seen = new Set(complete[0].reads.map((r) => r.case));
  const missing = fixtureCases.filter((c) => !seen.has(c));
  if (missing.length)
    problems.push(`${v}: missing cases ${missing.join(", ")}`);
  const short = [...groups.values()].filter(
    (g) => g.version === v && g.nComplete !== want,
  );
  if (short.length)
    problems.push(
      `${v}: ${short.length} read points not read ${want} times in the complete run`,
    );
  const hellos = vFiles.map((f) => f.meta?.hello).filter(Boolean);
  if (hellos.some((h) => h.vscode !== v))
    problems.push(
      `${v}: VS Code ${[...new Set(hellos.map((h) => h.vscode))].join("+")}`,
    );
  const vims = new Set(hellos.map((h) => h.vim?.version ?? "none"));
  const wks = new Set(hellos.map((h) => h.whichkey?.version ?? "none"));
  if (vims.size !== 1 || wks.size !== 1)
    problems.push(
      `${v}: VSCodeVim ${[...vims].join("+")}, which-key ${[...wks].join("+")}`,
    );
}
const incomplete = files.filter((f) => !f.complete && f.metaCount === 1);
console.log(
  `ROW (a) grammar fixture (${versions.join(", ")}): ${new Set([...groups.values()].map((g) => g.case)).size} of ${fixtureCases.length} cases, ` +
    `${groups.size} read points, ${total} reads (${pass} matched), incomplete runs counted ${incomplete.length} (${incomplete.reduce((s, f) => s + f.reads.length, 0)} reads), ` +
    `build ${builds.join("+")}: ${problems.length || versions.length === 0 ? "not pass" : "pass"}${problems.length ? ` (${problems.join("; ")})` : ""}`,
);
