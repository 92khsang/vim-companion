// pnpm check-ids (design §8): the commands and actions that the catalog names, and the commands that
// pnpm gen writes, must be in the ID snapshots ids/vscode.json and ids/intellij.json. Prints
// "<file>: <where>: <message>" lines in sorted order and a summary line; exits 0 when every ID
// resolves and 1 when some do not.
// --root <dir>: the spec directory to check; by default the one this file is in.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readCatalogFiles, readJsonFile } from "./catalog-files.mts";
import {
  checkIds,
  idSummary,
  type CommandFile,
  type IdSnapshots,
} from "./core/ids.mts";

// The commands that pnpm gen writes into the VS Code settings. Seam: once tools/core/gen.mts
// exists, use its GENERATED_COMMAND_IDS instead of this list.
const GENERATED_COMMAND_IDS = ["whichkey.show"];

const { values } = parseArgs({ options: { root: { type: "string" } } });
const root = resolve(values.root ?? join(import.meta.dirname, ".."));
const commands = readCatalogFiles(root).commands as CommandFile[];
const snapshots = {
  vscode: readJsonFile(root, join(root, "ids/vscode.json")),
  intellij: readJsonFile(root, join(root, "ids/intellij.json")),
} as IdSnapshots;
const found = checkIds(commands, snapshots, GENERATED_COMMAND_IDS);
const lines = found
  .map(({ file, where, message }) => `${file}: ${where}: ${message}`)
  .sort();
for (const line of lines) console.log(line);
console.log(idSummary(commands, GENERATED_COMMAND_IDS, found));
process.exitCode = lines.length > 0 ? 1 : 0;
