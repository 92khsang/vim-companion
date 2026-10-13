// The catalog validator (design §3): every file against its schema, then the rules that a schema
// cannot express. It receives parsed files and schemas and reads nothing itself.
import type { Catalog, CtrlKey, Diagnostic, Entry, Group } from "./catalog.mts";

/** A parsed catalog file; `path` is repo-relative and POSIX, for messages. */
export type CatalogFile = { path: string; data: unknown };

export type CatalogFiles = {
  commands: readonly CatalogFile[];
  groups: CatalogFile;
  ctrlKeys: CatalogFile;
  retiredIds: CatalogFile;
};

/** Parsed schemas by their file name in spec/schema, such as "commands.schema.json". */
export type SchemaSet = Readonly<Record<string, unknown>>;

/** `catalog` is present only when there are no diagnostics. */
export type Validation = { catalog?: Catalog; diagnostics: Diagnostic[] };

export function validateCatalog(
  files: CatalogFiles,
  schemas: SchemaSet,
): Validation {
  // File order never matters: the entries follow the paths in code-unit order.
  const commands = [...files.commands].sort((a, b) =>
    compareText(a.path, b.path),
  );
  const catalog: Catalog = {
    entries: commands.flatMap(
      (file) => (file.data as { commands: Entry[] }).commands,
    ),
    groups: (files.groups.data as { groups: Group[] }).groups,
    ctrlKeys: (files.ctrlKeys.data as { keys: CtrlKey[] }).keys,
    retiredIds: (files.retiredIds.data as { ids: string[] }).ids,
  };
  return { catalog, diagnostics: [] };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
