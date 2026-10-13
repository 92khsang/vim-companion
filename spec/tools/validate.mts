// pnpm spec:check: validates the catalog (design §3). Prints "<file>: <where>: <message>" lines in
// sorted order and exits 1 when there are any.
// --root <dir>: the spec directory to check; by default the one this file is in.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readCatalogFiles, readSchemas } from "./catalog-files.mts";
import { validateCatalog } from "./core/validate.mts";

const { values } = parseArgs({ options: { root: { type: "string" } } });
const root = resolve(values.root ?? join(import.meta.dirname, ".."));
const { diagnostics } = validateCatalog(
  readCatalogFiles(root),
  readSchemas(root),
);
const lines = diagnostics
  .map(({ file, where, message }) => `${file}: ${where}: ${message}`)
  .sort();
for (const line of lines) console.log(line);
process.exitCode = lines.length > 0 ? 1 : 0;
