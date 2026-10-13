// pnpm check-ids (design §8): the commands and actions that the catalog names, and the commands that
// pnpm gen writes, must be in the ID snapshots ids/vscode.json and ids/intellij.json. Prints
// "<file>: <where>: <message>" lines in sorted order and a summary line; exits 0 when every ID
// resolves, 1 when some do not, and 2 when it cannot run, such as for a catalog that spec:check
// rejects or a snapshot that is missing or breaks schema/ids.schema.json; then it prints why on
// stderr, each line after "check-ids: ".
// --root <dir>: the spec directory to check; by default the one this file is in.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  readCatalogFiles,
  readJsonFile,
  readSchemas,
} from "./catalog-files.mts";
import type { Diagnostic } from "./core/catalog.mts";
import { generatedCommandIds } from "./core/gen.mts";
import {
  checkIds,
  idSummary,
  type CommandFile,
  type IdSnapshots,
} from "./core/ids.mts";
import { prefixLines, thrownMessage } from "./core/messages.mts";
import { checkSchemas, validateCatalog } from "./core/validate.mts";

/** The exit code of a check of the spec directory that the arguments name. */
function run(): number {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = resolve(values.root ?? join(import.meta.dirname, ".."));
  const schemas = readSchemas(root);
  const files = readCatalogFiles(root);
  const { catalog, diagnostics } = validateCatalog(files, schemas);
  if (catalog === undefined) return cannotRun(lines(diagnostics));
  const vscode = readJsonFile(root, join(root, "ids/vscode.json"));
  const intellij = readJsonFile(root, join(root, "ids/intellij.json"));
  const broken = checkSchemas(
    [
      { file: vscode, schema: "ids.schema.json#/$defs/vscode" },
      { file: intellij, schema: "ids.schema.json#/$defs/intellij" },
    ],
    schemas,
  );
  if (broken.length > 0) return cannotRun(lines(broken));
  // Both checks passed, so the files have the types of the catalog and of the snapshots.
  const commands = files.commands as CommandFile[];
  const snapshots = { vscode, intellij } as IdSnapshots;
  // The commands that pnpm gen writes into the VS Code settings.
  const generated = generatedCommandIds(catalog);
  const found = checkIds(commands, snapshots, generated);
  for (const line of lines(found)) console.log(line);
  console.log(idSummary(commands, generated, found));
  return found.length > 0 ? 1 : 0;
}

/** "<file>: <where>: <message>" lines in sorted order. */
function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics
    .map(({ file, where, message }) => `${file}: ${where}: ${message}`)
    .sort();
}

/** Prints why the check cannot run, each line after "check-ids: ", and returns its exit code. */
function cannotRun(messages: readonly string[]): number {
  for (const line of prefixLines("check-ids: ", messages)) console.error(line);
  return 2;
}

try {
  process.exitCode = run();
} catch (error) {
  process.exitCode = cannotRun([thrownMessage(error)]);
}
