// pnpm gen (design §7.4): writes spec/generated/ from the catalog and the fixtures: the IDE files of
// genIde, at the version in package.json, and fixtures-index.json. Prints a line per key that an
// IDE leaves out as unsupported.
// --root <dir>: the spec directory; by default the one this file is in.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  readCatalogFiles,
  readFixtureFiles,
  readSchemas,
} from "./catalog-files.mts";
import { fixtureIndex } from "./core/fixtures.mts";
import { genIde, unsupportedLines } from "./core/gen.mts";
import { validateCatalog } from "./core/validate.mts";

const { values } = parseArgs({ options: { root: { type: "string" } } });
const root = resolve(values.root ?? join(import.meta.dirname, ".."));
const catalog = validateCatalog(
  readCatalogFiles(root),
  readSchemas(root),
).catalog!;
const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as { version: string };
const files = new Map([
  ...genIde(catalog, { version }),
  ["fixtures-index.json", fixtureIndex(readFixtureFiles(root))],
]);
for (const line of unsupportedLines(catalog, { version })) console.log(line);
for (const [path, text] of files) {
  const file = join(root, "generated", path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
