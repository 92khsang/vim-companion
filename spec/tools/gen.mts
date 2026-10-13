// pnpm gen (design §7.4): writes spec/generated/ from the catalog and the fixtures: the IDE files of
// genIde, at the version in package.json, and fixtures-index.json; deletes the files there that it
// no longer writes. Prints a line per key that an IDE leaves out as unsupported.
// --root <dir>: the spec directory; by default the one this file is in.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  readCatalogFiles,
  readFixtureFiles,
  readSchemas,
} from "./catalog-files.mts";
import { fixtureIndex } from "./core/fixtures.mts";
import { genIde, unsupportedLines } from "./core/gen.mts";
import { validateCatalog } from "./core/validate.mts";

/** The files below a directory as POSIX paths relative to it; none when it does not exist. */
function filesBelow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((dirent) => dirent.isFile())
    .map((dirent) =>
      relative(dir, join(dirent.parentPath, dirent.name)).split(sep).join("/"),
    );
}

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
const dir = join(root, "generated");
for (const path of filesBelow(dir)) {
  if (!files.has(path)) rmSync(join(dir, path));
}
for (const [path, text] of files) {
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
