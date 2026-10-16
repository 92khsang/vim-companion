// Builds the static cards of candidate (b) from the completeness reference: per card, one row per
// key (or placeholder class), with a `when` condition on VSCodeVim settings. The condition is the
// smallest conjunction of setting values (none, one or two) that predicts the row's presence in
// every measured settings set: VSCodeVim's defaults, each setting changed alone, replaceWithRegister
// paired with each other setting, and all five changed. Labels stay empty until written by hand.
// Usage: S2_CARDS_PREFIX=cards2 node spike/s2/harness/cards-build.mjs <version> <out cards.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rowsOf } from "./cards-count.mjs";
import { SETTINGS_SETS } from "./cards-extract.mjs";

const [version, outFile] = process.argv.slice(2);
const prefix = process.env.S2_CARDS_PREFIX ?? "cards";
const DEFAULTS = {
  "vim.surround": true,
  "vim.targets.enable": false,
  "vim.camelCaseMotion.enable": false,
  "vim.sneak": false,
  "vim.replaceWithRegister": false,
};
const sets = Object.keys(SETTINGS_SETS).map((set) => ({
  set,
  config: { ...DEFAULTS, ...SETTINGS_SETS[set] },
  data: JSON.parse(
    readFileSync(
      join(process.env.S2_ROOT, "runs", `${prefix}-${set}-${version}.json`),
      "utf8",
    ),
  ),
}));
const names = Object.keys(DEFAULTS);
const literals = names.flatMap((k) => [
  [k, true],
  [k, false],
]);
const candidates = [
  [],
  ...literals.map((l) => [l]),
  ...literals.flatMap((a, i) =>
    literals
      .slice(i + 1)
      .filter((b) => b[0] !== a[0])
      .map((b) => [a, b]),
  ),
];

const cards = [];
const unexplained = [];
sets[0].data.cards.forEach((card, i) => {
  const present = sets.map(
    (s) => new Set(rowsOf(s.data.cards[i], s.data.settings).keys()),
  );
  const keys = [...new Set(present.flatMap((p) => [...p]))].sort();
  const rows = keys.map((key) => {
    const fits = candidates.find((cand) =>
      sets.every(
        (s, j) =>
          cand.every(([k, v]) => s.config[k] === v) === present[j].has(key),
      ),
    );
    if (!fits) unexplained.push(`${card.id} ${key}`);
    const when = fits ? Object.fromEntries(fits) : { unexplained: true };
    return { key, ...(Object.keys(when).length ? { when } : {}), label: "" };
  });
  cards.push({
    id: card.id,
    title: `${card.mode} after ${card.keys.join("") || "nothing"}`,
    keys: card.keys,
    rows,
  });
});
writeFileSync(outFile, JSON.stringify(cards, null, 1));
console.log(
  `${cards.length} cards, ${cards.reduce((n, c) => n + c.rows.length, 0)} rows, ${cards.reduce((n, c) => n + c.rows.filter((r) => r.when).length, 0)} conditional, ${sets.length} settings sets; unexplained: ${unexplained.length} ${unexplained.slice(0, 10).join(", ")}`,
);
