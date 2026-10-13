import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  entryOf,
  miniCatalogFiles,
  type MiniCatalogFiles,
} from "./support/mini-catalog.mts";

const specDir = join(import.meta.dirname, "..");
const cli = join(specDir, "tools/validate.mts");
const base = mkdtempSync(join(tmpdir(), "spec-check-"));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Writes the catalog and the real schemas to <base>/<name>/spec and returns that directory. */
function writeSpec(name: string, files: MiniCatalogFiles): string {
  const root = join(base, name, "spec");
  cpSync(join(specDir, "schema"), join(root, "schema"), { recursive: true });
  for (const { path, data } of [
    ...files.commands,
    files.groups,
    files.ctrlKeys,
    files.retiredIds,
  ]) {
    const file = join(base, name, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  return root;
}

/** A run that could not check: exit 2, nothing on stdout, a spec:check message with `text`. */
function cannotRun(text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    status: 2,
    stdout: "",
    stderr: expect.stringMatching(new RegExp(`^spec:check: .*${escaped}`)),
  };
}

function specCheck(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [cli, ...args],
    { encoding: "utf8" },
  );
  return { status, stdout, stderr };
}

describe("spec:check", () => {
  test("prints nothing and exits 0 for a valid catalog", () => {
    const root = writeSpec("valid", miniCatalogFiles());
    expect(specCheck("--root", root)).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  test("prints the diagnostics as sorted lines and exits 1 for an invalid catalog", () => {
    const files = miniCatalogFiles();
    files.groups.data.groups.push(
      { keys: "SPC w", label: "Windows" },
      { keys: "SPC w m", label: "Moves" },
    );
    entryOf(files, "search.project").aliases![0]!.until = "1.0";
    const root = writeSpec("invalid", files);
    expect(specCheck("--root", root)).toEqual({
      status: 1,
      stdout: [
        'spec/catalog/commands/search.json: search.project: aliases[0].until "1.0" is not a version x.y.z[-prerelease]',
        'spec/catalog/groups.json: SPC w m: the prefix already has the group label "Move"',
        'spec/catalog/groups.json: SPC w: the prefix already has the group label "Window"',
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("exits 2 with a message when it cannot run", () => {
    const missing = join(base, "missing", "spec");
    const brokenJson = writeSpec("broken-json", miniCatalogFiles());
    writeFileSync(join(brokenJson, "catalog/groups.json"), "{\n");
    const noSchema = writeSpec("no-schema", miniCatalogFiles());
    rmSync(join(noSchema, "schema/commands.schema.json"));
    expect([
      specCheck("--root", missing),
      specCheck("--rot", missing),
      specCheck("--root", brokenJson),
      specCheck("--root", noSchema),
    ]).toEqual([
      cannotRun(missing),
      cannotRun("'--rot'"),
      cannotRun("spec/catalog/groups.json: "),
      cannotRun('no schema with key or ref "commands.schema.json"'),
    ]);
  });
});
