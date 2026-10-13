import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
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
});
