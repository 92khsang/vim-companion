import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const specDir = join(import.meta.dirname, "..");
const cli = join(specDir, "tools/gen.mts");
const golden = join(specDir, "test/golden/mini");
const base = mkdtempSync(join(tmpdir(), "gen-"));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/**
 * Copies the real schemas and fixtures, the catalog of golden/mini and a package.json with the
 * version to <base>/<name>/spec and returns that directory.
 */
function writeSpec(name: string, version = "0.0.0"): string {
  const root = join(base, name, "spec");
  for (const [from, to] of [
    [join(specDir, "schema"), "schema"],
    [join(specDir, "fixtures"), "fixtures"],
    [join(golden, "catalog"), "catalog"],
  ] as const) {
    cpSync(from, join(root, to), { recursive: true });
  }
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ version })}\n`);
  return root;
}

/** The text of every file under generated/ of a spec directory, by its path there. */
function generated(root: string): Record<string, string> {
  const dir = join(root, "generated");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((dirent) => dirent.isFile())
      .map((dirent) => {
        const path = join(dirent.parentPath, dirent.name);
        return [
          relative(dir, path).split(sep).join("/"),
          readFileSync(path, "utf8"),
        ];
      }),
  );
}

/** What gen writes for golden/mini: its hand-written goldens and the index of the real fixtures. */
function expected(): Record<string, string> {
  const read = (path: string) => readFileSync(path, "utf8");
  return {
    "fixtures-index.json": read(join(specDir, "generated/fixtures-index.json")),
    "intellij/vim-companion.ideavimrc": read(
      join(golden, "expected/intellij/vim-companion.ideavimrc"),
    ),
    "vscode/vim-remaps.json": read(
      join(golden, "expected/vscode/vim-remaps.json"),
    ),
    "vscode/whichkey-bindings.json": read(
      join(golden, "expected/vscode/whichkey-bindings.json"),
    ),
  };
}

/** The keys of golden/mini that one IDE does not support. */
const UNSUPPORTED = [
  "gen: unsupported in VS Code: SPC f l (file.locations)",
  "gen: unsupported in IntelliJ: SPC w = (window.equalize)",
];

function gen(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [cli, ...args],
    { encoding: "utf8" },
  );
  return { status, stdout, stderr };
}

describe("gen", () => {
  test("writes the IDE files and the fixture index to generated/ and prints the unsupported keys", () => {
    const root = writeSpec("write");
    expect(gen("--root", root)).toEqual({
      status: 0,
      stdout: [...UNSUPPORTED, ""].join("\n"),
      stderr: "",
    });
    expect(generated(root)).toEqual(expected());
  });

  test("deletes the files under generated/ that it no longer writes", () => {
    const root = writeSpec("delete");
    mkdirSync(join(root, "generated/old"), { recursive: true });
    writeFileSync(join(root, "generated/old/stale.json"), "{}\n");
    writeFileSync(join(root, "generated/whichkey.bindings.json"), "[]\n");
    expect(gen("--root", root).status).toBe(0);
    expect(generated(root)).toEqual(expected());
  });
});
