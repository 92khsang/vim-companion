// Builds the static cards of candidate (b) from the completeness reference: per card, one row per
// key (or placeholder class), with a `when` condition on the VSCodeVim setting that the row depends
// on, found by comparing the extraction with VSCodeVim's defaults against the extractions that
// change one setting each. Labels stay empty until they are written by hand.
// Usage: node spike/s2/harness/cards-build.mjs <version> <out cards.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rowsOf } from "./cards-count.mjs";

const [version, outFile] = process.argv.slice(2);
const root = process.env.S2_ROOT;
const load = (set) =>
  JSON.parse(
    readFileSync(join(root, "runs", `cards-${set}-${version}.json`), "utf8"),
  );
const DEFAULTS = {
  "vim.surround": true,
  "vim.targets.enable": false,
  "vim.camelCaseMotion.enable": false,
  "vim.sneak": false,
  "vim.replaceWithRegister": false,
};
const SINGLES = {
  "surround-off": "vim.surround",
  targets: "vim.targets.enable",
  camelcase: "vim.camelCaseMotion.enable",
  sneak: "vim.sneak",
  "replace-with-register": "vim.replaceWithRegister",
};
const base = load("defaults");
const all = load("extensions");
const singles = Object.fromEntries(
  Object.keys(SINGLES).map((s) => [s, load(s)]),
);
const rowSet = (d, i) => new Set(rowsOf(d.cards[i], d.settings).keys());

const cards = [];
const unexplained = [];
base.cards.forEach((card, i) => {
  const inBase = rowSet(base, i);
  const inAll = rowSet(all, i);
  const inSingle = Object.fromEntries(
    Object.keys(SINGLES).map((s) => [s, rowSet(singles[s], i)]),
  );
  const keys = new Set([
    ...inBase,
    ...inAll,
    ...Object.values(inSingle).flatMap((x) => [...x]),
  ]);
  const rows = [];
  for (const key of [...keys].sort()) {
    const when = {};
    for (const [s, setting] of Object.entries(SINGLES)) {
      if (inSingle[s].has(key) !== inBase.has(key))
        when[setting] = inBase.has(key)
          ? DEFAULTS[setting]
          : !DEFAULTS[setting];
    }
    // Check the conditions against the extraction that changes every setting at once.
    const predicted =
      Object.entries(when).every(([k, v]) => all.settings[k] === v) &&
      (Object.keys(when).length > 0 || inBase.has(key));
    if (predicted !== inAll.has(key)) unexplained.push(`${card.id} ${key}`);
    rows.push({
      key,
      ...(Object.keys(when).length ? { when } : {}),
      label: "",
    });
  }
  cards.push({
    id: card.id,
    title: `${card.mode} after ${card.keys.join("") || "nothing"}`,
    keys: card.keys,
    rows,
  });
});
writeFileSync(outFile, JSON.stringify(cards, null, 1));
console.log(
  `${cards.length} cards, ${cards.reduce((n, c) => n + c.rows.length, 0)} rows, ${cards.reduce((n, c) => n + c.rows.filter((r) => r.when).length, 0)} conditional; unexplained by single settings: ${unexplained.length} ${unexplained.slice(0, 10).join(", ")}`,
);
