// Counts the rows that each card needs: one row per key, except that the keys that only match an
// action through a placeholder (<character>, <register>, <number>, <alpha>, <macro>, <any>) at the
// next position share one row per placeholder. Adds the remap rows.
// Usage: node spike/s2/harness/cards-count.mjs <cards.json>...
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./lib.mjs";

const PLACEHOLDERS = new Set([
  "<leader>",
  "<character>",
  "<register>",
  "<number>",
  "<alpha>",
  "<macro>",
  "<any>",
]);
const remaps = JSON.parse(
  readFileSync(join(REPO, "spec/generated/vscode/vim-remaps.json"), "utf8"),
);
const PLUGIN = [
  ["y", "s"],
  ["y", "s", "s"],
  ["c", "s"],
  ["d", "s"],
]; // VSCodeVim default surround maps

export function remapRows(card, settings) {
  const normal = remaps["vim.normalModeKeyBindingsNonRecursive"].map(
    (r) => r.before,
  );
  if (settings["vim.surround"] !== false) normal.push(...PLUGIN);
  const visual = remaps["vim.visualModeKeyBindingsNonRecursive"].map(
    (r) => r.before,
  );
  const table =
    card.mode === "normal"
      ? normal
      : card.mode.startsWith("visual")
        ? visual
        : [];
  // VSCodeVim checks remaps for the next key only when no action is waiting for a key, and the
  // Normal-mode remaps only when no operator is pending (modeHandler.ts L504, remapper.ts L108). Keys buffered for
  // a remap (bufferedBefore) continue only that remap.
  const b = card.bufferedBefore;
  const waiting = (card.actionKeys ?? []).length > 0;
  const opPending = card.resolvedState.operator !== null;
  if (b.length === 0 && (waiting || opPending || card.mode === "insert"))
    return [];
  const keys = new Set();
  for (const before of table) {
    const norm = before.map((k) => (k === "<space>" ? " " : k));
    if (norm.length > b.length && b.every((k, i) => norm[i] === k))
      keys.add(norm[b.length]);
  }
  return [...keys];
}

export function rowsOf(card, settings) {
  const rows = new Map();
  for (const [key, actions] of Object.entries(card.actionRows)) {
    const next = card.resolvedState.pending.length ? null : null;
    void next;
    const viaPlaceholder = actions.every((a) => {
      const seqs = Array.isArray(a.keys[0]) ? a.keys : [a.keys];
      return seqs.every((s) => !s.includes(key));
    });
    const placeholder = viaPlaceholder
      ? [
          ...new Set(
            actions.flatMap((a) =>
              (Array.isArray(a.keys[0]) ? a.keys : [a.keys])
                .flat()
                .filter((k) => PLACEHOLDERS.has(k)),
            ),
          ),
        ]
          .sort()
          .join("|") || "?"
      : null;
    const rowKey = placeholder ? `{${placeholder}}` : key;
    rows.set(rowKey, (rows.get(rowKey) ?? 0) + 1);
  }
  for (const k of remapRows(card, settings)) if (!rows.has(k)) rows.set(k, 1);
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of process.argv.slice(2)) {
    const d = JSON.parse(readFileSync(file, "utf8"));
    let total = 0;
    const per = [];
    for (const c of d.cards) {
      const rows = rowsOf(c, d.settings);
      total += rows.size;
      per.push(`${c.mode}:${c.keys.join("")}=${rows.size}`);
    }
    console.log(
      `${d.version} ${d.set}: ${d.cards.length} cards, ${total} rows`,
    );
    console.log(per.join(" "));
  }
}
