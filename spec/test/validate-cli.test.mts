import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type {
  CatalogFixture,
  HintViewFixture,
} from "../tools/core/fixtures.mts";
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

/**
 * Writes the catalog, the real schemas and the real fixtures to <base>/<name>/spec and returns
 * that directory.
 */
function writeSpec(name: string, files: MiniCatalogFiles): string {
  const root = join(base, name, "spec");
  cpSync(join(specDir, "schema"), join(root, "schema"), { recursive: true });
  cpSync(join(specDir, "fixtures"), join(root, "fixtures"), {
    recursive: true,
  });
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

  test('starts each line on stderr with "spec:check: ", also in a message of several lines', () => {
    // V8 quotes the text around a JSON syntax error, line breaks included.
    const root = writeSpec("json-error-lines", miniCatalogFiles());
    const text = '{\n  "commands": [\n    x\n  ]\n}\n';
    writeFileSync(join(root, "catalog/commands/search.json"), text);
    let message = "";
    try {
      JSON.parse(text);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("\n");
    expect(specCheck("--root", root)).toEqual({
      status: 2,
      stdout: "",
      stderr: `spec/catalog/commands/search.json: ${message}`
        .split("\n")
        .map((line) => `spec:check: ${line}\n`)
        .join(""),
    });
  });

  test("exits 2 with a message when a fixture file is missing or not JSON", () => {
    const noVersionOrder = writeSpec("no-version-order", miniCatalogFiles());
    const versionOrder = join(noVersionOrder, "fixtures/version-order.json");
    rmSync(versionOrder);
    const brokenFixture = writeSpec("broken-fixture", miniCatalogFiles());
    writeFileSync(join(brokenFixture, "fixtures/hint-view/menu.json"), "{\n");
    expect([
      specCheck("--root", noVersionOrder),
      specCheck("--root", brokenFixture),
    ]).toEqual([
      cannotRun(versionOrder),
      cannotRun("spec/fixtures/hint-view/menu.json: "),
    ]);
  });

  test("prints the diagnostics of the fixture files sorted with those of the catalog", () => {
    const files = miniCatalogFiles();
    files.groups.data.groups.push({ keys: "SPC w", label: "Windows" });
    const root = writeSpec("invalid-fixtures", files);
    /** Changes a copied fixture file. */
    function edit<T>(path: string, change: (data: T) => void) {
      const file = join(root, "fixtures", path);
      const data = JSON.parse(readFileSync(file, "utf8")) as T;
      change(data);
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    }
    edit<CatalogFixture>("catalog/leader.json", (data) => {
      data.cases[1]!.id = "root";
    });
    edit<HintViewFixture>("hint-view/badges.json", (data) => {
      data.catalog.groups.push({ keys: "SPC t", label: "Tab" });
    });
    edit<Record<string, unknown>>("hint-view/menu.json", (data) => {
      data.note = "x";
    });
    expect(specCheck("--root", root)).toEqual({
      status: 1,
      stdout: [
        'spec/catalog/groups.json: SPC w: the prefix already has the group label "Window"',
        "spec/fixtures/catalog/leader.json: root: cases[1] repeats the id of cases[0]",
        "spec/fixtures/hint-view/badges.json: SPC t: no leader key is below this prefix",
        'spec/fixtures/hint-view/menu.json: /: must NOT have additional properties: "note"',
        "",
      ].join("\n"),
      stderr: "",
    });
  });
});
