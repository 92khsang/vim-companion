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
  return leaderLeaves(catalog, options)
    .filter(
      ({ key }) =>
        key.startsWith(parent) && !key.slice(parent.length).includes(" "),
    )
    .map(({ key, entry }) => ({
      key: key.slice(parent.length),
      label: entry.label,
      group: false,
      badge: null,
    }))
    .sort((a, b) => compareKeys([a.key], [b.key]));
}
