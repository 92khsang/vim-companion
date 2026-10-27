// Summary of check (1) of candidate (b) (batch/check1.sh): per settings set and VS Code version, the
// rows in force, the trials, the rows that passed every trial, every failing row with the fields
// that differed and whether the row carries a knownDeviation, the rows recorded as untyped (a token
// nothing on Linux produces), the rows the builder left out, the errors, and a ROW line with the
// criterion as written: 100% of card rows, in every trial, give the effect that the row states
// (3 trials per row at 30 ms, both settings sets, both versions).
// A row passes only when it has at least 3 trials, every one ok. A negative row (a key marked
// unsupported on Linux, check1/unsupported.mjs) is ok in a trial when no chord a Linux user would
// press delivered its token; such rows are counted apart and stay inside the 100% rule. Untyped,
// left-out and unmeasured rows do not pass. Every record of the directory counts, kept incomplete runs included. The runs
// must share one clean build, hello.vscode must equal the version, and each version must have one
// VSCodeVim and one which-key version.
// Usage: node spike/s2/batch/check1-summary.mjs <check1 data dir>
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const SETS = ["defaults", "extensions"];
const VERSIONS = ["1.134.0", "1.141.0"];
const TRIALS = 3;
const input = Object.fromEntries(
  SETS.map((s) => [
    s,
    {
      cards: JSON.parse(
        readFileSync(join(dir, "input", `correctness-${s}.json`), "utf8"),
      ),
      excluded: JSON.parse(
        readFileSync(join(dir, "input", `excluded-${s}.json`), "utf8"),
      ),
    },
  ]),
);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".jsonl"))
  .sort();
const recs = files.flatMap((f) =>
  readFileSync(join(dir, f), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ ...JSON.parse(l), file: f })),
);
const metaOf = new Map();
for (const r of recs) if (r.type === "meta") metaOf.set(r.file, r);
const problems = [];
const builds = new Set(
  recs
    .filter((r) => r.type === "meta" || r.type === "error")
    .map((r) => r.build?.id ?? "none"),
);
if (builds.size !== 1 || builds.has("none"))
  problems.push(`builds: ${[...builds].join(", ") || "none"}`);
for (const r of recs.filter((r) => r.type === "meta" || r.type === "error"))
  if (r.build?.dirty?.length)
    problems.push(`${r.file}: build with uncommitted changes`);
// The run conditions, checked before any ROW so that a problem fails every ROW.
for (const m of metaOf.values()) {
  if (m.hello?.vscode !== m.version)
    problems.push(
      `${m.file}: hello.vscode ${m.hello?.vscode} under ${m.version}`,
    );
  if (m.trials < TRIALS)
    problems.push(
      `${m.file}: ${m.trials} trials per row (the row needs ${TRIALS})`,
    );
  if (m.only && !/^#\d+-\d+$/.test(m.only))
    problems.push(`${m.file}: card selection ${m.only}`);
}
for (const v of VERSIONS) {
  const metas = [...metaOf.values()].filter((m) => m.version === v);
  const vims = new Set(metas.map((m) => m.hello?.vim?.version ?? "none"));
  const whichkeys = new Set(
    metas.map((m) => m.hello?.whichkey?.version ?? "none"),
  );
  if (
    metas.length &&
    (vims.size !== 1 ||
      vims.has("none") ||
      whichkeys.size !== 1 ||
      whichkeys.has("none"))
  )
    problems.push(`${v}: VSCodeVim ${[...vims]}, which-key ${[...whichkeys]}`);
}
const lines = [];
const rows = [];
for (const v of VERSIONS)
  for (const s of SETS) {
    const metas = [...metaOf.values()].filter(
      (m) => m.version === v && m.set === s,
    );
    const mine = recs.filter(
      (r) => metaOf.get(r.file)?.version === v && metaOf.get(r.file)?.set === s,
    );
    const errors = recs.filter(
      (r) => r.type === "error" && r.version === v && r.set === s,
    );
    const trialsOf = new Map();
    for (const t of mine.filter((r) => r.type === "trial")) {
      const k = `${t.card}\u0000${t.key}`;
      if (!trialsOf.has(k)) trialsOf.set(k, []);
      trialsOf.get(k).push(t);
    }
    const untyped = new Map(
      mine
        .filter((r) => r.type === "untyped")
        .map((r) => [`${r.card}\u0000${r.key}`, r]),
    );
    let inForce = 0;
    let pass = 0;
    // Negative rows (a token nothing on Linux produces, marked unsupported): counted apart, and
    // inside the 100% rule like every other row.
    const neg = { rows: 0, trials: 0, pass: 0 };
    const failing = [];
    const unmeasured = [];
    for (const c of input[s].cards)
      for (const row of c.rows) {
        inForce += 1;
        const k = `${c.id}\u0000${row.key}`;
        const ts = trialsOf.get(k) ?? [];
        if (row.negative) {
          neg.rows += 1;
          neg.trials += ts.length;
        }
        if (untyped.has(k)) continue;
        if (ts.length < TRIALS) {
          unmeasured.push({ card: c.id, key: row.key, trials: ts.length });
          continue;
        }
        if (ts.every((t) => t.ok)) {
          pass += 1;
          if (row.negative) neg.pass += 1;
        } else
          failing.push({
            card: c.id,
            key: row.key,
            trials: ts.length,
            failed: ts.filter((t) => !t.ok).length,
            diff: [...new Set(ts.flatMap((t) => t.diff))],
            knownDeviation: Boolean(row.knownDeviation),
            negative: row.negative
              ? ts.flatMap((t) =>
                  (t.tries ?? [])
                    .filter((x) => x.delivered)
                    .map((x) => x.chord.join(" ")),
                )
              : null,
          });
      }
    const excluded = input[s].excluded;
    inForce += excluded.length;
    const trials = mine.filter((r) => r.type === "trial").length;
    const ok = metas.length > 0 && pass === inForce && problems.length === 0;
    rows.push({ v, s, ok });
    lines.push(
      `${s} ${v}: ${inForce} rows in force, ${trials} trials, ${pass} rows pass every trial (negative rows ${neg.rows}: ${neg.trials} trials, ${neg.pass} pass); failing ${failing.length} (knownDeviation ${failing.filter((f) => f.knownDeviation).length}), untyped ${untyped.size}, left out ${excluded.length}, unmeasured ${unmeasured.length}, errors ${errors.length}`,
    );
    for (const f of failing)
      lines.push(
        `  FAIL ${f.card} ${JSON.stringify(f.key)}: ${f.failed} of ${f.trials} trials, differ in ${f.diff.join(",")}${f.knownDeviation ? ", knownDeviation" : ""}${f.negative ? `, negative row: the token arrived by ${f.negative.join("; ")}` : ""}`,
      );
    for (const u of untyped.values())
      lines.push(
        `  UNTYPED ${u.card} ${JSON.stringify(u.key)}: ${[...u.unreachable.map((x) => `${x.token}: unreachable on Linux`), ...u.untypeable.map((t) => `${t}: no key`)].join("; ")}`,
      );
    for (const x of excluded)
      lines.push(
        `  LEFT OUT ${x.card} ${JSON.stringify(x.key)}: ${x.why.join(", ")}`,
      );
    for (const u of unmeasured)
      lines.push(
        `  UNMEASURED ${u.card} ${JSON.stringify(u.key)}: ${u.trials} trials`,
      );
    for (const e of errors)
      lines.push(
        `  ERROR ${e.file} (${e.phase}): ${String(e.error).split("\n")[0]}`,
      );
    lines.push(
      `ROW check1 ${s} ${v}: ${pass} of ${inForce} rows pass every trial: ${ok ? "pass" : "not pass"}`,
    );
  }
console.log(`files: ${files.length}; builds: ${[...builds].join(", ")}`);
for (const p of problems) console.log(`PROBLEM ${p}`);
for (const l of lines) console.log(l);
const all = rows.length === 4 && rows.every((r) => r.ok);
console.log(
  `ROW check1: 100% of card rows in every trial, both settings sets, both versions: ${all ? "pass" : "not pass"}`,
);
