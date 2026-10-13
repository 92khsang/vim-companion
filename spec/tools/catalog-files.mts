// Reads the catalog and the schemas of a spec directory into the shapes the core validates. File
// paths for messages are relative to the parent of the spec directory and use "/", such as
// "spec/catalog/groups.json".
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { CatalogFile, CatalogFiles, SchemaSet } from "./core/validate.mts";

/** The path of a file below the spec directory `root`, for messages. */
export function repoPath(root: string, path: string): string {
  return relative(dirname(root), path).split(sep).join("/");
}

/** The parsed JSON files of a directory, in code-unit order of their names. */
function jsonFiles(root: string, dir: string): CatalogFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readJsonFile(root, join(dir, name)));
}

/** A parsed JSON file. */
export function readJsonFile(root: string, path: string): CatalogFile {
  return {
    path: repoPath(root, path),
    data: JSON.parse(readFileSync(path, "utf8")),
  };
}

/** catalog/commands/*.json, groups.json, ctrl-keys.json and retired-ids.json of a spec directory. */
export function readCatalogFiles(root: string): CatalogFiles {
  const catalog = join(root, "catalog");
  return {
    commands: jsonFiles(root, join(catalog, "commands")),
    groups: readJsonFile(root, join(catalog, "groups.json")),
    ctrlKeys: readJsonFile(root, join(catalog, "ctrl-keys.json")),
    retiredIds: readJsonFile(root, join(catalog, "retired-ids.json")),
  };
}

/** The schemas in schema/ of a spec directory, by file name. */
export function readSchemas(root: string): SchemaSet {
  return Object.fromEntries(
    jsonFiles(root, join(root, "schema")).map(({ path, data }) => [
      path.slice(path.lastIndexOf("/") + 1),
      data,
    ]),
  );
}
