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
import type { Entry } from "../tools/core/catalog.mts";

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

  test("--check exits 0 when generated/ is up to date and otherwise prints each stale file and exits 1, writing nothing", () => {
    const root = writeSpec("check");
    gen("--root", root);
    const clean = gen("--root", root, "--check");
    rmSync(join(root, "generated/fixtures-index.json"));
    writeFileSync(join(root, "generated/vscode/vim-remaps.json"), "{}\n");
    writeFileSync(join(root, "generated/vscode/old.json"), "{}\n");
    const stale = generated(root);
    expect([clean, gen("--root", root, "--check")]).toEqual([
      { status: 0, stdout: [...UNSUPPORTED, ""].join("\n"), stderr: "" },
      {
        status: 1,
        stdout: [
          ...UNSUPPORTED,
          "missing spec/generated/fixtures-index.json",
          "extra spec/generated/vscode/old.json",
          "changed spec/generated/vscode/vim-remaps.json",
          "run: pnpm gen",
          "",
        ].join("\n"),
        stderr: "",
      },
    ]);
    expect(generated(root)).toEqual(stale);
  });

  test("exits 2 with a message and writes nothing when it cannot run", () => {
    const missing = join(base, "missing", "spec");
    const invalid = writeSpec("invalid-catalog");
    editCommands(join(invalid, "catalog/commands/search.json"), ([search]) => {
      search!.aliases![0]!.until = "1.0";
    });
    const badVersion = writeSpec("bad-version", "1.0");
    const clash = writeSpec("clash");
    editCommands(join(clash, "catalog/commands/file.json"), (commands) => {
      commands.push({
        ...commands[0]!,
        id: "file.pick",
        keys: { leader: ["SPC f f"] },
        modes: ["x"],
        label: "Pick file",
      });
    });
    expect([
      gen("--root", missing),
      gen("--rot", missing),
      gen("--root", invalid),
      gen("--root", badVersion),
      gen("--root", clash),
    ]).toEqual([
      cannotRun(missing),
      cannotRun("'--rot'"),
      {
        status: 2,
        stdout: "",
        stderr:
          'gen: spec/catalog/commands/search.json: search.project: aliases[0].until "1.0" is not a version x.y.z[-prerelease]\n',
      },
      {
        status: 2,
        stdout: "",
        stderr:
          'gen: spec/package.json: version "1.0" is not a version x.y.z[-prerelease]\n',
      },
      {
        status: 2,
        stdout: "",
        stderr:
          'gen: spec/catalog/commands/file.json: file.pick: keys.leader[0] "SPC f f" is also bound by file.find\n',
      },
    ]);
    expect([invalid, badVersion, clash].map(generated)).toEqual([{}, {}, {}]);
  });

  test('starts each line on stderr with "gen: ", also in a message of several lines', () => {
    // V8 quotes the text around a JSON syntax error, line breaks included.
    const root = writeSpec("broken-json");
    const text = '{\n  "commands": [\n    x\n  ]\n}\n';
    writeFileSync(join(root, "catalog/commands/search.json"), text);
    let message = "";
    try {
      JSON.parse(text);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("\n");
    expect(gen("--root", root)).toEqual({
      status: 2,
      stdout: "",
      stderr: `spec/catalog/commands/search.json: ${message}`
        .split("\n")
        .map((line) => `gen: ${line}\n`)
        .join(""),
    });
    expect(generated(root)).toEqual({});
  });
});

/** Changes the entries of a command file in place. */
function editCommands(path: string, edit: (commands: Entry[]) => void): void {
  const data = JSON.parse(readFileSync(path, "utf8")) as { commands: Entry[] };
  edit(data.commands);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** A run that could not run: exit 2, nothing on stdout, a gen message with `text`. */
function cannotRun(text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    status: 2,
    stdout: "",
    stderr: expect.stringMatching(new RegExp(`^gen: .*${escaped}`)),
  };
}
