// The catalog validator (design §3): every file against its schema, then the rules that a schema
// cannot express. It receives parsed files and schemas and reads nothing itself.
import type { AnySchema, ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
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
  const schemaErrors = checkSchemas(
    [
      ...commands.map((file) => ({ file, schema: "commands.schema.json" })),
      { file: files.groups, schema: "groups.schema.json" },
      { file: files.ctrlKeys, schema: "ctrl-keys.schema.json" },
      { file: files.retiredIds, schema: "retired-ids.schema.json" },
    ],
    schemas,
  );
  if (schemaErrors.length > 0) {
    return { diagnostics: sortDiagnostics(schemaErrors) };
  }
  // Every file matches its schema, so the data has the catalog types from here on.
  const context: Context = {
    placed: commands.flatMap((file) =>
      (file.data as { commands: Entry[] }).commands.map((entry) => ({
        file: file.path,
        stem: stemOf(file.path),
        entry,
      })),
    ),
    groups: {
      file: files.groups.path,
      groups: (files.groups.data as { groups: Group[] }).groups,
    },
    ctrlKeys: {
      file: files.ctrlKeys.path,
      keys: (files.ctrlKeys.data as { keys: CtrlKey[] }).keys,
    },
    retiredIds: {
      file: files.retiredIds.path,
      ids: (files.retiredIds.data as { ids: string[] }).ids,
    },
  };
  const diagnostics = sortDiagnostics(RULES.flatMap((rule) => rule(context)));
  if (diagnostics.length > 0) return { diagnostics };
  return {
    catalog: {
      entries: context.placed.map(({ entry }) => entry),
      groups: context.groups.groups,
      ctrlKeys: context.ctrlKeys.keys,
      retiredIds: context.retiredIds.ids,
    },
    diagnostics,
  };
}

/** Rule SCHEMA: ajv 2020 in strict mode, every error of every file. */
function checkSchemas(
  checks: { file: CatalogFile; schema: string }[],
  schemas: SchemaSet,
): Diagnostic[] {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // Keyed by file name, so a relative $ref such as "commands.schema.json#/$defs/label" resolves.
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema as AnySchema, name);
  }
  return checks.flatMap(({ file, schema }) => {
    // Throws when the schema is missing or breaks strict mode: the check cannot run.
    ajv.validate(schema, file.data);
    return (ajv.errors ?? []).map((error) => ({
      file: file.path,
      where: error.instancePath || "/",
      code: "SCHEMA",
      message: schemaMessage(error),
    }));
  });
}

/** ajv's message, plus the property or values it leaves out. */
function schemaMessage(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") {
    return `${error.message}: ${JSON.stringify(error.params.additionalProperty)}`;
  }
  if (error.keyword === "enum") {
    const allowed = (error.params.allowedValues as unknown[]).map((value) =>
      JSON.stringify(value),
    );
    return `${error.message}: ${allowed.join(", ")}`;
  }
  return String(error.message);
}

/** By file, place, message and code, in code-unit order. */
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const key = (d: Diagnostic) =>
    [d.file, d.where, d.message, d.code].join("\0");
  return diagnostics.sort((a, b) => compareText(key(a), key(b)));
}

/** An entry and the command file it comes from. */
type Placed = { file: string; stem: string; entry: Entry };

/** What the rules after SCHEMA see: typed data and the file of each part. */
type Context = {
  placed: Placed[];
  groups: { file: string; groups: Group[] };
  ctrlKeys: { file: string; keys: CtrlKey[] };
  retiredIds: { file: string; ids: string[] };
};

/** The rules after SCHEMA, in the order of design §3. */
const RULES: ((context: Context) => Diagnostic[])[] = [
  checkDuplicateIds,
  checkCategories,
];

/** A diagnostic on an entry. */
function onEntry(
  { file, entry }: Placed,
  code: string,
  message: string,
): Diagnostic {
  return { file, where: entry.id, code, message };
}

/** Rule CATEGORY_MISMATCH: the file stem, the category and the first part of the id agree. */
function checkCategories({ placed }: Context): Diagnostic[] {
  return placed.flatMap((at) => {
    const { stem, entry } = at;
    const found: Diagnostic[] = [];
    if (entry.category !== stem) {
      found.push(
        onEntry(
          at,
          "CATEGORY_MISMATCH",
          `category ${q(entry.category)} differs from the file stem ${q(stem)}`,
        ),
      );
    }
    if (!entry.id.startsWith(`${entry.category}.`)) {
      found.push(
        onEntry(
          at,
          "CATEGORY_MISMATCH",
          `the id must start with the category: ${q(`${entry.category}.`)}`,
        ),
      );
    }
    return found;
  });
}

/** Rule DUPLICATE_ID: an id names one entry in the whole catalog. */
function checkDuplicateIds({ placed }: Context): Diagnostic[] {
  const firstFile = new Map<string, string>();
  return placed.flatMap((at) => {
    const first = firstFile.get(at.entry.id);
    if (first === undefined) {
      firstFile.set(at.entry.id, at.file);
      return [];
    }
    return [onEntry(at, "DUPLICATE_ID", `the id is already used in ${first}`)];
  });
}

/** "spec/catalog/commands/code.json" → "code". */
function stemOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

/** A value quoted for a message. */
const q = (value: string): string => JSON.stringify(value);

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
