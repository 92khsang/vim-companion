// Marks the check (1) rows whose key nothing on Linux produces (harness/card-keys.mjs: unreachable)
// as unsupported on Linux. Check (2) needs the rows, so they stay in the cards; the criterion's
// completeness clause allows "a row that marks a key unsupported and gives a reason". The row's
// label says it is not available on Linux and why (card-keys.mjs `label`), `source` becomes
// `unsupported-linux` with the reason and its source lines, and the fields it replaces are kept
// under `previous`. Its check (1) verification is negative (cards-correctness.mjs): in each trial
// the harness sends every chord of the token's `tries` and the row passes only when VSCodeVim never
// receives the token. Idempotent: a row that is already marked is left as it is.
// Usage: node spike/s2/check1/unsupported.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOKENS } from "../harness/card-keys.mjs";

const DIR = new URL("./cards/", import.meta.url).pathname;
const REPLACED = [
  "source",
  "reason",
  "label",
  "labelFrom",
  "labelIndex",
  "labelReview",
  "expect",
  "knownDeviation",
  "basis",
  "pending",
  "variants",
  "expectBasis",
];
let marked = 0;
let already = 0;
for (const f of readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const path = join(DIR, f);
  const card = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;
  for (const row of card.rows) {
    const t = TOKENS[row.key];
    if (!t?.unreachable) continue;
    if (row.source === "unsupported-linux") {
      already += 1;
      continue;
    }
    // A setup (such as the inserted text of the Ctrl+@ row) stays: the negative check sends the
    // chords in the row's state.
    if (row.bySet)
      throw new Error(`${f} ${row.key}: a per-set row is not handled`);
    const previous = Object.fromEntries(
      REPLACED.filter((k) => k in row).map((k) => [k, row[k]]),
    );
    for (const k of REPLACED) delete row[k];
    Object.assign(row, {
      source: "unsupported-linux",
      reason: `unreachable on Linux: ${t.unreachable}`,
      label: t.label,
      labelFrom: "hand",
      unsupported: { token: row.key },
      previous,
    });
    marked += 1;
    changed = true;
  }
  if (changed) writeFileSync(path, JSON.stringify(card, null, 1) + "\n");
}
console.log(JSON.stringify({ marked, already }));
