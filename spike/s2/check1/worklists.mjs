// Splits the rows that need a hand author (spike/s2/check1/cards/*.json: `hand` under a set, or a
// `vim-oracle` label flagged for review) into work lists of about equal effort, grouped by card so
// that one author owns all of a card's entries. Each entry carries what the author needs: the
// card's keys, the settings sets and the reason per set, the generated remap's commands, the
// VSCodeVim actions that apply to the key in the card's state (from the card reference and a
// static read of the VSCodeVim sources), the plugin setting, Vim's index line, and whether the
// harness can type the keys.
// Usage: node spike/s2/check1/worklists.mjs <n lists> <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { REPO, keysym } from "../harness/lib.mjs";
import {
  VIMRUNTIME,
  normToken,
  splitPending,
  modeOf,
  pendingOf,
} from "../vim-check/expect.mjs";
import { SETS, cardFile } from "./lib.mjs";

const [nArg, outDir] = process.argv.slice(2);
const n = Number(nArg);
const S2 = join(REPO, "spike/s2");
const cards = JSON.parse(readFileSync(join(S2, "cards/cards.json"), "utf8"));
const remaps = JSON.parse(
  readFileSync(join(REPO, "spec/generated/vscode/vim-remaps.json"), "utf8"),
);
const actions = JSON.parse(
  readFileSync(join(S2, "data/check1/vscodevim-actions-1.32.4.json"), "utf8"),
).actions;
const reference = Object.fromEntries(
  SETS.map((s) => [
    s,
    new Map(
      JSON.parse(
        gunzipSync(
          readFileSync(
            join(S2, `data/cards-reference/cards3-${s}-1.141.0.json.gz`),
          ),
        ),
      ).cards.map((c) => [c.id, c]),
    ),
  ]),
);
const indexLines = readFileSync(
  join(VIMRUNTIME, "doc/index.txt"),
  "utf8",
).split("\n");
const VSCODEVIM_MODE = {
  normal: "Normal",
  insert: "Insert",
  visual: "Visual",
  "visual-line": "VisualLine",
  "visual-block": "VisualBlock",
};
const seqs = (keys) => (Array.isArray(keys[0]) ? keys : [keys]);
const sameSeqs = (a, b) => JSON.stringify(seqs(a)) === JSON.stringify(seqs(b));

function actionsFor(card, key, set) {
  const ref = reference[set].get(card.id);
  // A placeholder row {<x>} is the key token <x> of the action table.
  const token = key.startsWith("{<") ? key.slice(1, -1) : key;
  const rows = ref?.actionRows?.[token] ?? ref?.prefixOnlyRows?.[token] ?? [];
  const mode = VSCODEVIM_MODE[modeOf(card)];
  return rows.map((r) => {
    const byKeys = actions.filter((a) => a.keys && sameSeqs(a.keys, r.keys));
    const byMode = byKeys.filter((a) => !a.modes || a.modes.includes(mode));
    const match = byMode.length ? byMode : byKeys;
    return {
      keys: r.keys,
      type: r.type,
      classes: match.map((a) => `${a.class} (${a.file} L${a.line})`),
      ...(match.length && !byMode.length
        ? { note: `no class lists mode ${mode}` }
        : {}),
    };
  });
}
function remapFor(card, key) {
  const mode = modeOf(card);
  const { op, rest } = splitPending(pendingOf(card));
  if (op) return null;
  const table =
    mode === "normal"
      ? remaps["vim.normalModeKeyBindingsNonRecursive"]
      : mode.startsWith("visual")
        ? remaps["vim.visualModeKeyBindingsNonRecursive"]
        : [];
  const seq = [...rest, key].map((k) => (k === " " ? "<space>" : k));
  const hit = table.filter(
    (r) =>
      r.before.length >= seq.length && seq.every((k, i) => r.before[i] === k),
  );
  return hit.length
    ? hit.map((r) => ({
        before: r.before,
        commands: r.commands ?? null,
        after: r.after ?? null,
      }))
    : null;
}
const typeable = (keys) =>
  keys.every((k) => {
    try {
      keysym(k);
      return true;
    } catch {
      return false;
    }
  });
// VSCodeVim 1.32.4 plugin sources, by the setting or reason that names the plugin.
const PLUGIN_SOURCES = {
  sneak: "src/actions/plugins/sneak.ts",
  surround: "src/actions/plugins/surround.ts",
  targets: "src/actions/plugins/targets/",
  camelCase: "src/actions/plugins/camelCaseMotion.ts",
  replaceWithRegister: "src/actions/plugins/replaceWithRegister.ts",
  leader:
    "src/actions/plugins/camelCaseMotion.ts and src/actions/plugins/easymotion/",
};
const WEIGHT = {
  own: 1,
  remap: 1,
  plugin: 1,
  state: 1,
  outside: 0.7,
  "null-mode": 0.5,
  oracle: 0.5,
};

const byCard = [];
for (const card of cards) {
  const input = JSON.parse(
    readFileSync(join(S2, "check1/cards", cardFile(card)), "utf8"),
  );
  const entries = [];
  for (const r of input.rows) {
    const per = Object.fromEntries(
      r.sets.map((s) => [s, { ...r, ...(r.bySet?.[s] ?? {}) }]),
    );
    const handSets = r.sets.filter((s) => per[s].source === "hand");
    const reviewSets = r.sets.filter(
      (s) => per[s].source === "vim-oracle" && per[s].labelReview,
    );
    if (!handSets.length && !reviewSets.length) continue;
    const reasons = Object.fromEntries(handSets.map((s) => [s, per[s].reason]));
    const kinds = [
      ...new Set(handSets.map((s) => per[s].reason.split(":")[0])),
    ];
    let effort = kinds.reduce((a, k) => a + (WEIGHT[k] ?? 1), 0);
    if (!handSets.length) effort = 0.2;
    const sample = per[r.sets[0]].sample;
    const typed = [...card.keys, sample && sample !== "TODO" ? sample : r.key];
    const facts = {
      cardKeys: card.keys,
      typeable: typeable(typed),
    };
    const remap = handSets.some((s) => per[s].reason.startsWith("remap"))
      ? remapFor(card, r.key)
      : null;
    if (remap) facts.remap = remap;
    const acts = Object.fromEntries(
      handSets
        .map((s) => [s, actionsFor(card, r.key, s)])
        .filter(([, a]) => a.length),
    );
    if (Object.keys(acts).length) facts.vscodevimActions = acts;
    const plugin = handSets
      .map((s) => per[s].reason)
      .find((x) => x.startsWith("plugin"));
    if (plugin || r.when)
      facts.plugin = { reason: plugin ?? null, when: r.when ?? null };
    const pluginFile = Object.entries(PLUGIN_SOURCES).find(([k]) =>
      [plugin ?? "", ...Object.keys(r.when ?? {})].some((x) => x.includes(k)),
    )?.[1];
    if (pluginFile) facts.pluginSource = pluginFile;
    const idx = per[r.sets[0]].labelIndex;
    if (idx) {
      const line = Number(/L(\d+)/.exec(idx)[1]);
      facts.vimIndex = `${idx}: ${indexLines[line - 1].trim()}`;
    }
    if (handSets.some((s) => per[s].reason.startsWith("null-mode")))
      facts.rule =
        "VSCodeVim shows the command line or search input as probe mode other-6 (CommandlineInProgress) or other-5 (SearchInProgressMode), with the text and cursor unchanged (spike/s2/data/check1/observe-1.141.0.json)";
    if (handSets.some((s) => per[s].reason.startsWith("state")))
      facts.rule =
        "VSCodeVim keeps this state from earlier rows of the run; give the row a setup that sets it in both engines (for example a yank before a put, a search before n), then write the expectation from that state";
    if (handSets.some((s) => per[s].reason.startsWith("outside")))
      facts.rule =
        "check (1) compares only text, cursor, mode and registers; write what the harness reads there and say in the label what the key does";
    entries.push({
      key: r.key,
      sets: r.sets,
      ...(handSets.length ? { hand: reasons } : {}),
      ...(reviewSets.length
        ? {
            labelReview: Object.fromEntries(
              reviewSets.map((s) => [s, per[s].labelReview]),
            ),
          }
        : {}),
      effort,
      facts,
    });
  }
  if (entries.length)
    byCard.push({
      card: card.id,
      file: `spike/s2/check1/cards/${cardFile(card)}`,
      effort: entries.reduce((a, e) => a + e.effort, 0),
      entries,
    });
}
const lists = Array.from({ length: n }, () => ({ effort: 0, cards: [] }));
for (const c of [...byCard].sort((a, b) => b.effort - a.effort)) {
  lists.sort((a, b) => a.effort - b.effort);
  lists[0].cards.push(c);
  lists[0].effort += c.effort;
}
mkdirSync(outDir, { recursive: true });
const summary = [];
lists
  .sort((a, b) => b.effort - a.effort)
  .forEach((l, i) => {
    const rows = l.cards.reduce((a, c) => a + c.entries.length, 0);
    const handRows = l.cards.reduce(
      (a, c) => a + c.entries.filter((e) => e.hand).length,
      0,
    );
    writeFileSync(
      join(outDir, `hand-${i + 1}.json`),
      JSON.stringify(
        {
          list: i + 1,
          effort: Math.round(l.effort * 10) / 10,
          rows,
          handRows,
          cards: l.cards,
        },
        null,
        1,
      ) + "\n",
    );
    summary.push({
      list: i + 1,
      cards: l.cards.length,
      rows,
      handRows,
      effort: Math.round(l.effort * 10) / 10,
    });
  });
console.log(JSON.stringify(summary));
