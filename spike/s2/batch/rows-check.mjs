// The cross-row check of candidate (a): issue #11 says "Candidate (a) passes when all three of its
// rows pass, measured with one adapter build and one poll interval", and every row runs on VS Code
// 1.134.0 and 1.141.0. This reads the precheck, the grammar fixture (the metas and error records of
// complete and kept incomplete runs), the differential row and the CPU row under a data directory
// and needs:
// - each of the four for both versions;
// - one build over all of their records (one build id; the frozen checkout gets no commit until
//   every row is done), hence one sha256 of the adapter, the probe and the harness, and one set of
//   VS Code builds and sandbox extensions;
// - one poll interval: the fixture metas' poll and adapterPollMs, and the pollMs of the adapter
//   checks of the differential runs and CPU windows with the adapter on;
// - one VSCodeVim and one which-key version over all records, and VS Code of the version label.
// It does not repeat the rows' own pass conditions; their ROW lines state them.
// Usage: node spike/s2/batch/rows-check.mjs [data dir, default spike/s2/data]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VERSIONS = ["1.134.0", "1.141.0"];
const data = process.argv[2] ?? "spike/s2/data";
const read = (dir, re) =>
  existsSync(join(data, dir))
    ? readdirSync(join(data, dir))
        .filter((n) => re.test(n))
        .flatMap((n) =>
          readFileSync(join(data, dir, n), "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => ({ ...JSON.parse(l), _file: `${dir}/${n}` })),
        )
    : [];
const rows = {
  precheck: read("precheck", /^off-.*\.jsonl$/).filter(
    (r) => r.type === "run" || r.type === "run-error",
  ),
  fixture: read("fixture-adapter", /^adapter-.*\.jsonl$/).filter(
    (r) => r.type === "meta" || r.type === "error",
  ),
  differential: read("differential-row", /^both-.*\.jsonl$/).filter(
    (r) => r.type === "run" || r.type === "run-error",
  ),
  cpu: read("cpu", /^cpu-.*\.jsonl$/),
};
const problems = [];
const ids = new Set();
const parts = { adapter: new Set(), probe: new Set(), harness: new Set() };
const polls = new Set();
const vims = new Set();
const wks = new Set();
for (const [name, recs] of Object.entries(rows)) {
  const versions = [...new Set(recs.map((r) => r.version))].sort();
  for (const v of VERSIONS)
    if (!versions.includes(v)) problems.push(`${name}: no records of ${v}`);
  for (const r of recs) {
    ids.add(r.build?.id ?? "none");
    for (const k of Object.keys(parts))
      parts[k].add(r.build?.sha256?.[k] ?? "none");
    if (r.hello) {
      vims.add(r.hello.vim?.version ?? "none");
      wks.add(r.hello.whichkey?.version ?? "none");
      if (r.hello.vscode !== r.version)
        problems.push(
          `${name}: ${r._file} has VS Code ${r.hello.vscode} under ${r.version}`,
        );
    }
  }
  if (name === "fixture")
    for (const m of recs.filter((r) => r.type === "meta")) {
      polls.add(m.poll);
      polls.add(m.adapterPollMs ?? "none");
    }
  if (name === "differential" || name === "cpu")
    for (const r of recs)
      if (r.arm === "on" && r.adapterCheck)
        polls.add(r.adapterCheck.pollMs ?? "none");
  console.log(
    `${name}: ${recs.length} records, versions ${versions.join("+") || "none"}, builds ${[...new Set(recs.map((r) => r.build?.id ?? "none"))].join("+") || "none"}`,
  );
}
if (ids.size !== 1) problems.push(`builds ${[...ids].join("+")}`);
for (const [k, s] of Object.entries(parts))
  if (s.size !== 1)
    problems.push(`sha256.${k} ${[...s].map((x) => x.slice(0, 12)).join("+")}`);
if (polls.size !== 1) problems.push(`poll intervals ${[...polls].join("+")}`);
if (vims.size !== 1) problems.push(`VSCodeVim ${[...vims].join("+")}`);
if (wks.size !== 1) problems.push(`which-key ${[...wks].join("+")}`);
console.log(
  `ROWS (a) one adapter build and one poll interval: build ${[...ids].join("+")}, poll ${[...polls].join("+")} ms, ` +
    `VSCodeVim ${[...vims].join("+")}, which-key ${[...wks].join("+")}: ${problems.length ? "not pass" : "pass"}${problems.length ? ` (${problems.join("; ")})` : ""}`,
);
