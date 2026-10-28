// The `S` rows of the Visual cards where S is Vim's v_S: in Visual and Visual Line mode under the
// second settings set (surround off; sneak does not take S there: src/actions/base.ts L257-279
// returns the first complete action) and in Visual Block mode under both sets (surround has no
// Visual Block S: src/actions/plugins/surround.ts L142-176). Vim's v_S is the same command as v_R
// (change.txt *v_S* *v_R*: "Currently just like {Visual}["x]S"), so the expectation is the card's
// `R` row, a vim-oracle row, under the same set. Where the hand author's expectation (read from
// VSCodeVim's VisualChangeLine_2 and VisualBlockChangeLine, src/actions/commands/actions.ts
// L917-953, which run the same code as the card's C and R rows) differs, it is kept as
// `knownDeviation`.
// Usage: node spike/s2/check1/visual-s.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../harness/lib.mjs";

const IN = join(REPO, "spike/s2/check1/cards");
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const BASIS = ["basis", "expectBasis", "expectFrom"];
const out = [];
for (const f of readdirSync(IN).filter((f) =>
  /^visual(-line|-block)?(-3|-dquote-a)?\.json$/.test(f),
)) {
  const file = join(IN, f);
  const card = JSON.parse(readFileSync(file, "utf8"));
  const block = f.startsWith("visual-block");
  const R = card.rows.find((r) => r.key === "R");
  const S = card.rows.find((r) => r.key === "S");
  if (!R || !S) continue;
  for (const set of S.sets) {
    if (!block && set !== "extensions") continue;
    const rv = { ...R, ...(R.bySet?.[set] ?? {}) };
    if (rv.source !== "vim-oracle" || !rv.expect)
      throw new Error(`${f} R (${set}) is not a vim-oracle row`);
    const sv = { ...S, ...(S.bySet?.[set] ?? {}) };
    const basis = Object.fromEntries(
      BASIS.filter((k) => sv[k]).map((k) => [k, sv[k]]),
    );
    const fields = {
      source: "vim-oracle",
      reason: `vim: v_S, the same command as v_R in Vim (change.txt *v_S* *v_R*); ${block ? "surround has no Visual Block S" : "surround is off and sneak does not take S in Visual mode"}, so VSCodeVim runs ${block ? "VisualBlockChangeLine" : "VisualChangeLine_2"} (src/actions/commands/actions.ts L917-953)`,
      expect: rv.expect,
      oracle: { from: "R", note: "the card's R row under the same set" },
      previousHand: { expect: sv.expect, ...basis },
    };
    if (!sameJson(sv.expect, rv.expect))
      fields.knownDeviation = {
        expect: sv.expect,
        ...basis,
        status:
          "Inferred: the hand author's reading of the VSCodeVim 1.32.4 source; not measured; the card's C and R rows run the same VSCodeVim code",
      };
    S.bySet ??= {};
    const common = Object.fromEntries(
      Object.entries(S).filter(
        ([k]) => !["key", "when", "sets", "bySet"].includes(k),
      ),
    );
    // Move every common field that the set now overrides into the other sets' bySet entries.
    for (const s of S.sets) S.bySet[s] = { ...common, ...(S.bySet[s] ?? {}) };
    for (const k of Object.keys(common)) delete S[k];
    const kept = Object.fromEntries(
      Object.entries(S.bySet[set]).filter(([k]) => !BASIS.includes(k)),
    );
    S.bySet[set] = { ...kept, ...fields };
    out.push(
      `${f} S (${set}): ${fields.knownDeviation ? "knownDeviation" : "same as before"}`,
    );
  }
  writeFileSync(file, JSON.stringify(card, null, 2) + "\n");
}
console.log(out.join("\n"));
