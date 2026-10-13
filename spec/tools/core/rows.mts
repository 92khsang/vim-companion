// The rows of a hint view (design §4): the children of a leader prefix in display order, each with
// its label and badge.
import type { Ide, KeyCatalog } from "./catalog.mts";
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
  const entries: Row[] = leaves
    .filter(({ key }) => child(key))
    .map(({ key, entry }) => ({
      key: key.slice(parent.length),
      label: entry.label,
      group: false,
      badge: null,
    }));
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
  return [...entries.sort(byKey), ...groups.sort(byKey)];
}
