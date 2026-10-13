// The rows of a hint view (design §4): the children of a leader prefix in display order, each with
// its label and badge.
import type { Entry, Ide, KeyCatalog } from "./catalog.mts";
import { compareKeys } from "./keys.mts";
import { leaderLeaves, type ResolveOptions } from "./resolve.mts";

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
  const parent = `${["SPC", ...prefix].join(" ")} `;
  const child = (key: string) =>
    key.startsWith(parent) && !key.slice(parent.length).includes(" ");
  const byKey = (a: Row, b: Row) => compareKeys([a.key], [b.key]);
  const leaves = leaderLeaves(catalog, options);
  const leafRows = (alias: boolean): Row[] =>
    leaves
      .filter((leaf) => leaf.alias === alias && child(leaf.key))
      .map(({ key, entry }) => ({
        key: key.slice(parent.length),
        // An alias moves its key to the entry's first leader key.
        label: alias ? `Moved to ${entry.keys.leader?.[0]}` : entry.label,
        group: false,
        badge: badge(entry, ide),
      }))
      .sort(byKey);
  const groups: Row[] = catalog.groups
    .filter(
      ({ keys }) =>
        child(keys) && leaves.some(({ key }) => key.startsWith(`${keys} `)),
    )
    .map(({ keys, label }) => ({
      key: keys.slice(parent.length),
      label,
      group: true,
      badge: null,
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
  if (entry.semantics?.[ENGINES[ide]] !== undefined) return "differs-from-vim";
  return null;
}
