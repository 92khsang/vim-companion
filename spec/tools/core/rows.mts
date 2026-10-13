// The rows of a hint view (design §4): the children of a leader prefix in display order, each with
// its label and badge.
import type { Entry, Ide, KeyCatalog } from "./catalog.mts";
import { compareKeys } from "./keys.mts";
import { leafBelow, leaderLeaves, type ResolveOptions } from "./resolve.mts";

/** One mark per row, the first that applies in this order; null when none does. */
export type Badge =
  "unsupported" | "experimental" | "fallback" | "differs-from-vim" | null;

/** `key` is the next leader key, such as "w" or "SPC"; `label` never carries a "+". */
export type Row = { key: string; label: string; group: boolean; badge: Badge };

/**
 * The children of the leader prefix (the keys after SPC; [] is the root) in display order: the
 * entries by key, then the aliases by key, then the groups by key. The catalog must be valid.
 */
export function rows(
  catalog: KeyCatalog,
  ide: Ide,
  prefix: readonly string[],
  options: ResolveOptions = {},
): Row[] {
  return entryRows(catalog, ide, prefix, options).map(({ row }) => row);
}

/** A row of rows() and the entry whose key it is; undefined for a group. */
export type EntryRow = { row: Row; entry: Entry | undefined };

/** The rows of rows() with the entry whose key each leaf row is. */
export function entryRows(
  catalog: KeyCatalog,
  ide: Ide,
  prefix: readonly string[],
  options: ResolveOptions = {},
): EntryRow[] {
  const parent = `${["SPC", ...prefix].join(" ")} `;
  const child = (key: string) =>
    key.startsWith(parent) && !key.slice(parent.length).includes(" ");
  const byKey = (a: EntryRow, b: EntryRow) =>
    compareKeys([a.row.key], [b.row.key]);
  const leaves = leaderLeaves(catalog, options);
  const leafRows = (alias: boolean): EntryRow[] =>
    leaves
      .filter((leaf) => leaf.alias === alias && child(leaf.key))
      .map(({ key, entry }) => ({
        row: {
          key: key.slice(parent.length),
          // An alias moves its key to the entry's first leader key.
          label: alias ? `Moved to ${entry.keys.leader?.[0]}` : entry.label,
          group: false,
          badge: badge(entry, ide),
        },
        entry,
      }))
      .sort(byKey);
  const groups: EntryRow[] = catalog.groups
    .filter(({ keys }) => child(keys) && leafBelow(leaves, keys))
    .map(({ keys, label }) => ({
      row: { key: keys.slice(parent.length), label, group: true, badge: null },
      entry: undefined,
    }));
  return [...leafRows(false), ...leafRows(true), ...groups.sort(byKey)];
}

/** The engine whose behaviour `semantics` describes for each IDE. */
const ENGINES = { vscode: "vscodevim", intellij: "ideavim" } as const;

/** The badge of an entry's rows in the IDE. */
function badge(entry: Entry, ide: Ide): Badge {
  const level = entry.support?.[ide]?.level;
  if (level === "none") return "unsupported";
  if (entry.stage === "experimental") return "experimental";
  if (level === "partial") return "fallback";
  // An IDE that runs the engine's keys behaves as Vim there; one that runs a command or action
  // differs where the entry says how the engine's own keys behave. A supported entry has the
  // IDE's block.
  const command =
    ide === "vscode"
      ? "command" in entry.vscode!.exec
      : "action" in entry.intellij!;
  if (command && entry.semantics?.[ENGINES[ide]] !== undefined) {
    return "differs-from-vim";
  }
  return null;
}
