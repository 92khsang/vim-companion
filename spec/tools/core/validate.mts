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

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
