// pnpm gen (design §7.4): writes spec/generated/ from the catalog and the fixtures: the IDE files of
// genIde, at the version in package.json, and fixtures-index.json; deletes the files there that it
// no longer writes. Prints a line per key that an IDE leaves out as unsupported.
// --check: writes nothing; prints "missing|changed|extra <path>" lines and "run: pnpm gen" and
// exits 1 when generated/ differs from what gen would write, 0 when it does not.
// Exits 2 when it cannot run, such as for a catalog that spec:check rejects, and prints why on
// stderr, each line after "gen: ".
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
  readJsonFile,
  readSchemas,
  repoPath,
} from "./catalog-files.mts";
import { fixtureIndex } from "./core/fixtures.mts";
import { genIde, unsupportedLines } from "./core/gen.mts";
import { prefixLines, thrownMessage } from "./core/messages.mts";
import { validateCatalog } from "./core/validate.mts";
import { isVersion } from "./core/version.mts";

/** The exit code of a run with the arguments. */
function run(): number {
  const { values } = parseArgs({
    options: { root: { type: "string" }, check: { type: "boolean" } },
  });
  const root = resolve(values.root ?? join(import.meta.dirname, ".."));
  const { catalog, diagnostics } = validateCatalog(
    readCatalogFiles(root),
    readSchemas(root),
  );
  if (catalog === undefined) {
    return cannotRun(
      diagnostics
        .map(({ file, where, message }) => `${file}: ${where}: ${message}`)
        .sort(),
    );
  }
  const version = packageVersion(root);
  // Everything is computed before anything is printed or written.
  const files = new Map([
    ...genIde(catalog, { version }),
    ["fixtures-index.json", fixtureIndex(readFixtureFiles(root))],
  ]);
  for (const line of unsupportedLines(catalog, { version })) console.log(line);
  const dir = join(root, "generated");
  if (values.check === true) return check(root, dir, files);
  write(dir, files);
  return 0;
}

/** The version in package.json of the spec directory, which decides the active aliases. */
function packageVersion(root: string): string {
  const { path, data } = readJsonFile(root, join(root, "package.json"));
  const { version } = data as { version?: unknown };
  if (typeof version !== "string" || !isVersion(version)) {
    throw new Error(
      `${path}: version ${JSON.stringify(version)} is not a version x.y.z[-prerelease]`,
    );
  }
  return version;
}

/** The files below a directory as POSIX paths relative to it; none when it does not exist. */
function filesBelow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((dirent) => dirent.isFile())
    .map((dirent) =>
      relative(dir, join(dirent.parentPath, dirent.name)).split(sep).join("/"),
    );
}

/** Writes the files to the directory and deletes the other files there. */
function write(dir: string, files: ReadonlyMap<string, string>): void {
  for (const path of filesBelow(dir)) {
    if (!files.has(path)) rmSync(join(dir, path));
  }
  for (const [path, text] of files) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

/** Prints how the directory differs from the files and returns the exit code: 1 when it does. */
function check(
  root: string,
  dir: string,
  files: ReadonlyMap<string, string>,
): number {
  const onDisk = filesBelow(dir);
  const stale = [
    ...[...files].flatMap(([path, text]) => {
      if (!onDisk.includes(path)) return [{ kind: "missing", path }];
      const same = readFileSync(join(dir, path), "utf8") === text;
      return same ? [] : [{ kind: "changed", path }];
    }),
    ...onDisk
      .filter((path) => !files.has(path))
      .map((path) => ({ kind: "extra", path })),
  ].sort((a, b) => Number(a.path > b.path) - Number(a.path < b.path));
  for (const { kind, path } of stale) {
    console.log(`${kind} ${repoPath(root, join(dir, path))}`);
  }
  if (stale.length === 0) return 0;
  console.log("run: pnpm gen");
  return 1;
}

/** Prints why gen cannot run, each line after "gen: ", and returns its exit code. */
function cannotRun(messages: readonly string[]): number {
  for (const line of prefixLines("gen: ", messages)) console.error(line);
  return 2;
}

try {
  process.exitCode = run();
} catch (error) {
  process.exitCode = cannotRun([thrownMessage(error)]);
}
