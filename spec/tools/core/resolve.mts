// Leader key resolution (design §4): where a sequence of leader keys leads in one IDE.
import type { Ide, KeyCatalog } from "./catalog.mts";

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
  const entry = catalog.entries.find((entry) =>
    entry.keys.leader?.includes(key),
  );
  if (entry !== undefined) {
    return {
      kind: "leaf",
      entry: entry.id,
      supported: entry.support?.[ide]?.level !== "none",
    };
  }
  return { kind: "unbound" };
}
