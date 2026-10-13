// The IDE files that pnpm gen writes from the catalog (design §6, §7).
import type { Catalog } from "./catalog.mts";

/** The files that genIde returns, relative to spec/generated/, in the order it returns them. */
export const GENERATED_PATHS = [
  "intellij/vim-companion.ideavimrc",
  "vscode/vim-remaps.json",
  "vscode/whichkey-bindings.json",
] as const;

/** `version`: the release whose aliases are active; "0.0.0" by default. */
export type GenOptions = { version?: string };

/** The text of each file of GENERATED_PATHS, in that order. The catalog must be valid. */
export function genIde(
  catalog: Catalog,
  options: GenOptions = {},
): Map<string, string> {
  return new Map(GENERATED_PATHS.map((path) => [path, ""]));
}
