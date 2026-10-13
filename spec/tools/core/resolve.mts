// Leader key resolution (design §4): where a sequence of leader keys leads in one IDE.
import type { Entry, Ide, KeyCatalog } from "./catalog.mts";
import { aliasActive } from "./version.mts";

/**
 * `experimental`: experimental entries are bound too. `version`: the release whose aliases are
 * active; "0.0.0" by default.
 */
export type ResolveOptions = { experimental?: boolean; version?: string };

/** Where leader keys lead: a group, an entry, or nowhere. */
export type Resolution =
  | { kind: "group"; label: string }
  | { kind: "leaf"; entry: string; supported: boolean }
  | { kind: "unbound" };

/**
 * Where the leader keys after SPC lead in the IDE: [] is the root, ["SPC"] is SPC SPC. The catalog
 * must be valid.
 */
export function resolve(
  catalog: KeyCatalog,
  ide: Ide,
  keys: readonly string[],
  options: ResolveOptions = {},
): Resolution {
  if (keys.length === 0) return { kind: "group", label: "" };
  const key = ["SPC", ...keys].join(" ");
  const leaf = leaderLeaves(catalog, options).find((leaf) => leaf.key === key);
  if (leaf !== undefined) {
    return {
      kind: "leaf",
      entry: leaf.entry.id,
      supported: leaf.entry.support?.[ide]?.level !== "none",
    };
  }
  const group = catalog.groups.find((group) => group.keys === key);
  if (group !== undefined) return { kind: "group", label: group.label };
  return { kind: "unbound" };
}

/** A bound leader key: a key of an entry or of one of its active aliases. */
type LeaderLeaf = { key: string; entry: Entry };

/**
 * The leader keys that the catalog binds with the options: the keys of the entries, of
 * experimental ones only with `experimental`, and of their aliases that are active at `version`.
 */
function leaderLeaves(
  catalog: KeyCatalog,
  options: ResolveOptions,
): LeaderLeaf[] {
  const version = options.version ?? "0.0.0";
  return catalog.entries
    .filter(
      (entry) => entry.stage === "stable" || options.experimental === true,
    )
    .flatMap((entry) => [
      ...(entry.keys.leader ?? []).map((key) => ({ key, entry })),
      ...(entry.aliases ?? [])
        .filter((alias) => aliasActive(alias, version))
        .flatMap((alias) =>
          (alias.keys.leader ?? []).map((key) => ({ key, entry })),
        ),
    ]);
}
