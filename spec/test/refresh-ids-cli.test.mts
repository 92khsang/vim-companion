import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, onTestFinished, test } from "vitest";
import { writeZip } from "./support/zip.mts";

const specDir = join(import.meta.dirname, "..");
const cli = join(specDir, "tools/refresh-ids.mts");
const base = mkdtempSync(join(tmpdir(), "refresh-ids-"));
// The runs never see the real home directory.
const home = join(base, "home");
mkdirSync(home);

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** For the tests that wait for processes to shut down: a generous timeout. */
const SLOW = { timeout: 60_000 };

function refresh(...args: string[]) {
  return refreshWith({}, ...args);
}

/** A run with these environment variables on top of a home directory of its own. */
function refreshWith(env: Record<string, string>, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [cli, ...args],
    { encoding: "utf8", env: { ...process.env, HOME: home, ...env } },
  );
  return { status, stdout, stderr };
}

/** A run that could not refresh: exit 2, nothing on stdout, an ids:refresh message with `text`. */
function cannotRun(text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    status: 2,
    stdout: "",
    stderr: expect.stringMatching(new RegExp(`^ids:refresh: .*${escaped}`)),
  };
}

/** An empty spec directory <dir>/spec with the real schemas, which the snapshots must pass. */
function specIn(dir: string): string {
  const root = join(dir, "spec");
  cpSync(join(specDir, "schema"), join(root, "schema"), { recursive: true });
  return root;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** The text of a file, or null when there is none. */
function textOf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** A plugin descriptor that declares these actions. */
const descriptor = (...ids: string[]) =>
  `<idea-plugin><actions>${ids.map((id) => `<action id="${id}" class="a.B"/>`).join("")}</actions></idea-plugin>\n`;

/** An IntelliJ home and plugins directory with a few jars, under <dir>. */
function fakeIntellij(dir: string): { ide: string; plugins: string } {
  const ide = join(dir, "ide");
  const plugins = join(dir, "plugins");
  writeText(
    join(ide, "product-info.json"),
    JSON.stringify({
      name: "IntelliJ IDEA",
      version: "2026.2.3",
      buildNumber: "262.1.2",
      productCode: "IU",
      dataDirectoryName: "IntelliJIdea2026.2",
    }),
  );
  writeZip(join(ide, "lib/app.jar"), {
    "META-INF/PlatformActions.xml": [
      "<idea-plugin>",
      "  <actions>",
      '    <action id="GotoFile" class="a.GotoFileAction"/>',
      '    <group id="GoToMenu"><action id="GotoClass" class="a.B"/></group>',
      '    <!-- <action id="Console.TableResult.Find"/> -->',
      "  </actions>",
      '  <extensions defaultExtensionNs="com.intellij">',
      '    <toolWindow id="Project" factoryClass="a.P"/>',
      '    <toolWindow id="Problems View" factoryClass="a.Q"/>',
      "  </extensions>",
      "</idea-plugin>",
    ].join("\n"),
    // Below the jar root: a keymap refers to actions and declares none.
    "keymaps/Default.xml": '<keymap><action id="KeymapOnly"/></keymap>',
    // Below META-INF: not a descriptor that the IDE loads.
    "META-INF/nested/extra.xml": descriptor("NestedOnly"),
    "intellij.platform.vcs.xml":
      '<idea-plugin><actions><action id="ActivateCommitToolWindow" class="a.C"/></actions>' +
      '<extensions defaultExtensionNs="com.intellij"><toolWindow id="Commit" factoryClass="a.D"/></extensions></idea-plugin>',
  });
  writeZip(join(ide, "plugins/git/lib/git.jar"), {
    "META-INF/plugin.xml": descriptor("Git.Commit"),
  });
  // The bundled Java runtime is not part of the IDE.
  writeZip(join(ide, "jbr/lib/jbr.jar"), {
    "META-INF/jbr.xml": descriptor("FromJbr"),
  });
  writeZip(join(plugins, "IdeaVIM/lib/IdeaVIM-9.9.9.jar"), {
    "META-INF/plugin.xml":
      "<idea-plugin><id>IdeaVIM</id><version>9.9.9</version>" +
      '<actions><action id="VimShortcutKeyAction" class="v.S"/></actions></idea-plugin>',
  });
  writeZip(join(plugins, "IdeaVIM/lib/modules/IdeaVIM.ideavim-frontend.jar"), {
    "IdeaVIM.ideavim-frontend.xml": descriptor("VimFindActionIdAction"),
  });
  writeZip(join(plugins, "Which-Key-1.0.jar"), {
    "META-INF/plugin.xml":
      "<idea-plugin><version>1.0</version>" +
      '<actions><action id="WhichKey.Show" class="w.S"/></actions></idea-plugin>',
  });
  writeZip(join(plugins, "Other/lib/other.jar"), {
    "META-INF/plugin.xml":
      "<idea-plugin><version>1.0</version>" +
      '<actions><action id="NotAllowListed" class="o.N"/></actions></idea-plugin>',
  });
  return { ide, plugins };
}

/**
 * A VS Code install, its built-in extensions and a home directory with installed extensions, under
 * <dir>. `code` stands in for VS Code with the dump extension: it writes to `log` how it was
 * started, then the dump of the extensions that its extensions directory holds. `bin` holds an
 * xvfb-run that runs its command without a display server.
 */
function fakeVscode(dir: string) {
  const app = join(dir, "code/resources/app");
  const code = join(dir, "code/code.mjs");
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  const json = (path: string, value: unknown) =>
    writeText(path, JSON.stringify(value));
  json(join(app, "package.json"), { name: "code-oss-dev", version: "1.200.0" });
  json(join(app, "extensions/markdown-language-features/package.json"), {
    contributes: {
      commands: [
        { command: "markdown.showPreview" },
        { command: "_markdown.copyImage" },
      ],
    },
  });
  json(join(app, "extensions/git/package.json"), {
    contributes: {
      keybindings: [{ command: "git.commit", key: "ctrl+enter" }],
    },
  });
  const installed = join(home, ".vscode/extensions");
  json(join(installed, "vscodevim.vim-1.32.4/package.json"), {
    publisher: "vscodevim",
    name: "vim",
    version: "1.32.4",
    contributes: {
      commands: [{ command: "toggleVim" }],
      keybindings: [{ command: "extension.vim_escape", key: "Escape" }],
    },
  });
  json(join(installed, "vspacecode.whichkey-0.11.4/package.json"), {
    publisher: "VSpaceCode",
    name: "whichkey",
    version: "0.11.4",
    contributes: { commands: [{ command: "whichkey.show" }] },
  });
  json(join(installed, "ms-python.python-2026.8.0/package.json"), {
    publisher: "ms-python",
    name: "python",
    version: "2026.8.0",
    contributes: { commands: [{ command: "python.execInTerminal" }] },
  });
  json(join(installed, "extensions.json"), []);
  writeText(
    code,
    [
      "#!/usr/bin/env node",
      'import { readdirSync, readFileSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const args = process.argv.slice(2);",
      "const option = (name) => args[args.indexOf(name) + 1];",
      'const extensions = option("--extensions-dir");',
      "const copied = readdirSync(extensions).sort();",
      'const manifests = copied.map((name) => JSON.parse(readFileSync(join(extensions, name, "package.json"), "utf8")));',
      "const env = process.env;",
      "// FAKE_CODE_SKIP: extensions that fail to activate.",
      'const skipped = (env.FAKE_CODE_SKIP ?? "").split(",");',
      'const activated = env.VIM_COMPANION_IDS_ACTIVATE.split(",").flatMap((id) => {',
      "  const found = manifests.find((m) => `${m.publisher}.${m.name}`.toLowerCase() === id.toLowerCase());",
      "  return found && !skipped.includes(id) ? [`${found.publisher}.${found.name}@${found.version}`] : [];",
      "});",
      "writeFileSync(env.FAKE_CODE_LOG, JSON.stringify({",
      "  args,",
      "  home: env.HOME,",
      "  xdg: [env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME],",
      "  wayland: env.WAYLAND_DISPLAY ?? null,",
      "  inherited: Object.keys(env).filter((name) => /^(VSCODE|ELECTRON)_/.test(name)),",
      "  copied,",
      '  settings: JSON.parse(readFileSync(join(option("--user-data-dir"), "User/settings.json"), "utf8")),',
      "}));",
      "// FAKE_CODE_NO_DUMP: VS Code fails before the dump extension writes anything.",
      'if (env.FAKE_CODE_NO_DUMP) { console.log("[main] Window failed to load"); process.exit(1); }',
      "// FAKE_CODE_HANG: VS Code never dumps or quits; it writes its PID to that file and stays",
      "// for a minute at most. FAKE_CODE_IGNORE_TERM: it ignores SIGTERM too.",
      "if (env.FAKE_CODE_HANG) {",
      '  if (env.FAKE_CODE_IGNORE_TERM) process.on("SIGTERM", () => {});',
      "  writeFileSync(env.FAKE_CODE_HANG, `${process.pid}\\n`);",
      "  setTimeout(() => process.exit(1), 60_000);",
      "  await new Promise(() => {});",
      "}",
      "// FAKE_CODE_BAD_DUMP: the dump extension writes this text, which is not JSON, as the dump.",
      "if (env.FAKE_CODE_BAD_DUMP) { writeFileSync(env.VIM_COMPANION_IDS_OUT, env.FAKE_CODE_BAD_DUMP); process.exit(0); }",
      "writeFileSync(env.VIM_COMPANION_IDS_OUT, JSON.stringify({",
      '  vscode: env.FAKE_CODE_VERSION ?? "1.200.0",',
      "  activated,",
      '  commands: ["vim.remap", "workbench.action.quickOpen"],',
      "}));",
      "",
    ].join("\n"),
  );
  chmodSync(code, 0o755);
  writeText(
    join(bin, "xvfb-run"),
    '#!/bin/sh\n[ "$1" = "-a" ] && shift\n[ "$1" = "--auth-file" ] && shift 2\nexec "$@"\n',
  );
  chmodSync(join(bin, "xvfb-run"), 0o755);
  return {
    code,
    home,
    log: join(dir, "run.json"),
    env: {
      HOME: home,
      PATH: [bin, dirname(process.execPath), process.env["PATH"]].join(":"),
      FAKE_CODE_LOG: join(dir, "run.json"),
      WAYLAND_DISPLAY: "wayland-1",
      VSCODE_IPC_HOOK_CLI: join(dir, "vscode.sock"),
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}

/**
 * An xvfb-run under <dir> that works like /usr/bin/xvfb-run with a stand-in for Xvfb: it starts
 * the server in the background, runs its command as a child and, on exit, sends the server
 * SIGTERM without waiting for it. Like Xvfb, the server holds a lock file while it runs and
 * removes it a little while after SIGTERM. Like xvfb-run, it keeps the X authority file in a
 * temporary directory of its own unless --auth-file names one, and removes that directory on
 * exit. The lock file and that directory are in `tmp`, the TMPDIR of the run, so that `tmp` is
 * empty once everything has shut down. xvfb-run writes its PID, the process group of the run, to
 * `group`. `path` is the PATH to put it in front of.
 */
function fakeXvfbRun(dir: string, path: string) {
  const bin = join(dir, "xvfb");
  const tmp = join(dir, "tmp");
  const group = join(dir, "xvfb-run.pid");
  mkdirSync(tmp, { recursive: true });
  const server = join(bin, "server.mjs");
  writeText(
    server,
    [
      'import { rmSync, writeFileSync } from "node:fs";',
      "const lock = process.argv[2];",
      "writeFileSync(lock, `${process.pid}\\n`);",
      'process.on("SIGTERM", () => setTimeout(() => {',
      "  rmSync(lock, { force: true });",
      "  process.exit(0);",
      "}, 300));",
      "// It never outlives the test by much.",
      "setTimeout(() => process.exit(1), 60_000);",
      "",
    ].join("\n"),
  );
  writeText(
    join(bin, "xvfb-run"),
    [
      "#!/bin/sh",
      `echo $$ > '${group}'`,
      '[ "$1" = "-a" ] && shift',
      'trap \'[ -z "$auth" ] || rm -r "$auth"; kill "$server"\' EXIT',
      'if [ "$1" = "--auth-file" ]; then shift 2; else auth=$(mktemp -d -t xvfb-run.XXXXXX); fi',
      'lock="$TMPDIR/.X99-lock"',
      `node '${server}' "$lock" &`,
      "server=$!",
      "# Like xvfb-run, it waits for the server to start: at most 30 s here.",
      "tries=600",
      'until [ -e "$lock" ]; do',
      "  tries=$((tries - 1))",
      '  [ "$tries" -gt 0 ] || exit 1',
      "  sleep 0.05",
      "done",
      '"$@"',
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "xvfb-run"), 0o755);
  return { tmp, group, env: { PATH: `${bin}:${path}`, TMPDIR: tmp } };
}

/** A run in the background; `exited` settles with what refreshWith returns. */
function startWith(env: Record<string, string>, ...args: string[]) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...process.env, HOME: home, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
  child.stderr.setEncoding("utf8").on("data", (text) => (stderr += text));
  const exited = new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((settle) => {
    child.on("close", (status) => settle({ status, stdout, stderr }));
  });
  return { child, exited };
}

/** Whether `check` holds within `ms` milliseconds; it is checked every 20 ms. */
async function eventually(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await delay(20);
  }
  return true;
}

/**
 * The process group in the file that the fake xvfb-run writes, or undefined while there is none.
 * Never 0: process.kill(-0) would signal the process group of the tests.
 */
function groupIn(file: string): number | undefined {
  const group = Number(textOf(file));
  return Number.isInteger(group) && group > 0 ? group : undefined;
}

/** Sends a signal (0: none, a check) to the group in `file`; false when it has no process left. */
function signalGroupIn(file: string, signal: NodeJS.Signals | 0): boolean {
  const group = groupIn(file);
  if (group === undefined) return false;
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
}

describe("ids:refresh", () => {
  test("exits 2 with a message when it cannot run", () => {
    const root = join(base, "cannot-run", "spec");
    const nowhere = join(base, "nowhere");
    const usage = {
      status: 2,
      stdout: "",
      stderr: "ids:refresh: name the IDE to refresh: vscode or intellij\n",
    };
    expect([
      refresh(),
      refresh("emacs"),
      refresh("vscode", "intellij"),
      refresh("vscode", "--plugin", "IdeaVIM"),
      refresh("intellij", "--extension", "vscodevim.vim"),
      refresh("vscode", "--codes", "code"),
      refresh("vscode", "--root", root, "--code", join(nowhere, "code")),
      refresh("intellij", "--root", root, "--ide-home", nowhere),
    ]).toEqual([
      usage,
      usage,
      usage,
      {
        status: 2,
        stdout: "",
        stderr: "ids:refresh: --plugin is an option of intellij, not vscode\n",
      },
      {
        status: 2,
        stdout: "",
        stderr:
          "ids:refresh: --extension is an option of vscode, not intellij\n",
      },
      cannotRun("'--codes'"),
      cannotRun(join(nowhere, "resources/app/package.json")),
      cannotRun(join(nowhere, "product-info.json")),
    ]);
  });

  test('names a JSON file that it cannot parse, with each line on stderr after "ids:refresh: "', () => {
    // V8 quotes the text around a JSON syntax error, line breaks included.
    const text = '{\n  "modules": [\n    x\n  ]\n}\n';
    let message = "";
    try {
      JSON.parse(text);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("\n");
    const fails = (file: string) => ({
      status: 2,
      stdout: "",
      stderr: `${file}: ${message}`
        .split("\n")
        .map((line) => `ids:refresh: ${line}\n`)
        .join(""),
    });
    const intellij = (root: string, fake: { ide: string; plugins: string }) =>
      refresh(
        "intellij",
        "--root",
        root,
        "--ide-home",
        fake.ide,
        "--plugins-dir",
        fake.plugins,
      );
    // A file of the IDE, named by its absolute path.
    const productDir = join(base, "broken-product-info");
    const productRoot = specIn(productDir);
    const product = fakeIntellij(productDir);
    const productInfo = join(product.ide, "product-info.json");
    writeText(productInfo, text);
    // The snapshot that the refresh replaces, named by its repo path.
    const snapshotDir = join(base, "broken-snapshot");
    const snapshotRoot = specIn(snapshotDir);
    const snapshotIde = fakeIntellij(snapshotDir);
    writeText(join(snapshotRoot, "ids/intellij.json"), text);
    // The manifest of an installed VS Code extension, which the refresh reads even when the
    // extension is not allow-listed; named by its absolute path.
    const vscodeDir = join(base, "broken-manifest");
    const vscodeRoot = specIn(vscodeDir);
    const vscode = fakeVscode(vscodeDir);
    const manifest = join(
      vscode.home,
      ".vscode/extensions/ms-python.python-2026.8.0/package.json",
    );
    writeText(manifest, text);
    // The runs below allow-list an extension: without one, the fake VS Code finds no extensions
    // directory and writes no dump.
    const vscodeRun = (
      root: string,
      fake: ReturnType<typeof fakeVscode>,
      env: Record<string, string> = {},
    ) =>
      refreshWith(
        { ...fake.env, ...env },
        "vscode",
        "--root",
        root,
        "--code",
        fake.code,
        "--extension",
        "vscodevim.vim",
      );
    // The package.json of VS Code itself, named by its absolute path.
    const appDir = join(base, "broken-app-package");
    const appRoot = specIn(appDir);
    const app = fakeVscode(appDir);
    const appPackage = join(appDir, "code/resources/app/package.json");
    writeText(appPackage, text);
    // The manifest of a built-in extension, which the refresh reads after the dump; named by its
    // absolute path.
    const builtinDir = join(base, "broken-builtin-manifest");
    const builtinRoot = specIn(builtinDir);
    const builtin = fakeVscode(builtinDir);
    const builtinManifest = join(
      builtinDir,
      "code/resources/app/extensions/git/package.json",
    );
    writeText(builtinManifest, text);
    // The dump, named by its path in the temporary directory of the run.
    const dumpDir = join(base, "broken-dump");
    const dumpRoot = specIn(dumpDir);
    const dump = fakeVscode(dumpDir);
    const results = [
      intellij(productRoot, product),
      intellij(snapshotRoot, snapshotIde),
      refreshWith(
        vscode.env,
        "vscode",
        "--root",
        vscodeRoot,
        "--code",
        vscode.code,
      ),
      vscodeRun(appRoot, app),
      vscodeRun(builtinRoot, builtin),
      vscodeRun(dumpRoot, dump, { FAKE_CODE_BAD_DUMP: text }),
    ];
    // The fake VS Code logs its arguments, which hold the temporary directory of the run.
    const log = textOf(dump.log);
    const temp = dirname(log === null ? "" : JSON.parse(log).args[1]);
    expect(results).toEqual([
      fails(productInfo),
      fails("spec/ids/intellij.json"),
      fails(manifest),
      fails(appPackage),
      fails(builtinManifest),
      fails(join(temp, "commands.json")),
    ]);
  });

  test("intellij writes the IDs that the IDE and the allow-listed plugins declare, and the runtime ones", () => {
    const dir = join(base, "intellij");
    const root = specIn(dir);
    const { ide, plugins } = fakeIntellij(dir);
    const run = (...args: string[]) => ({
      ...refresh(
        "intellij",
        "--root",
        root,
        "--ide-home",
        ide,
        "--plugins-dir",
        plugins,
        ...args,
      ),
      written: textOf(join(root, "ids/intellij.json")),
    });
    const runtime = [
      "ActivateProblemsViewToolWindow",
      "ActivateProjectToolWindow",
      "Debug",
      "DebugClass",
      "Run",
      "RunClass",
    ];
    const withIdeaVim = {
      status: 0,
      stdout:
        "ids:refresh: wrote spec/ids/intellij.json: 7 declared and 6 runtime IDs from IU-262.1.2, IdeaVIM 9.9.9\n",
      stderr: "",
      written: `${JSON.stringify(
        {
          ide: "IU-262.1.2",
          plugins: { IdeaVIM: "9.9.9" },
          declared: [
            "ActivateCommitToolWindow",
            "Git.Commit",
            "GoToMenu",
            "GotoClass",
            "GotoFile",
            "VimFindActionIdAction",
            "VimShortcutKeyAction",
          ],
          runtime,
        },
        null,
        2,
      )}\n`,
    };
    // The second run keeps the plugins of the snapshot it replaces.
    expect([
      run("--plugin", "IdeaVIM"),
      run(),
      run("--drop-plugin", "IdeaVIM", "--plugin", "Which-Key-1.0.jar"),
    ]).toEqual([
      withIdeaVim,
      withIdeaVim,
      {
        status: 0,
        stdout:
          "ids:refresh: wrote spec/ids/intellij.json: 6 declared and 6 runtime IDs from IU-262.1.2, Which-Key-1.0.jar 1.0\n",
        stderr: "",
        written: `${JSON.stringify(
          {
            ide: "IU-262.1.2",
            plugins: { "Which-Key-1.0.jar": "1.0" },
            declared: [
              "ActivateCommitToolWindow",
              "Git.Commit",
              "GoToMenu",
              "GotoClass",
              "GotoFile",
              "WhichKey.Show",
            ],
            runtime,
          },
          null,
          2,
        )}\n`,
      },
    ]);
  });

  test("intellij reads the jars with an unzip that has no -W, like the one in macOS", () => {
    const dir = join(base, "intellij-no-w");
    const root = specIn(dir);
    const { ide, plugins } = fakeIntellij(dir);
    // macOS's /usr/bin/unzip rejects -W with exit 10; this one hands every other call to unzip.
    const bin = join(dir, "bin");
    const realUnzip = spawnSync("sh", ["-c", "command -v unzip"], {
      encoding: "utf8",
    }).stdout.trim();
    writeText(
      join(bin, "unzip"),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "-W" ] && { echo "unzip: -W: invalid option" >&2; exit 10; }; done\nexec ${realUnzip} "$@"\n`,
    );
    chmodSync(join(bin, "unzip"), 0o755);

    const run = refreshWith(
      { PATH: [bin, process.env["PATH"]].join(":") },
      "intellij",
      "--root",
      root,
      "--ide-home",
      ide,
      "--plugins-dir",
      plugins,
      "--plugin",
      "IdeaVIM",
    );

    expect({
      ...run,
      written: textOf(join(root, "ids/intellij.json")),
    }).toEqual({
      status: 0,
      stdout:
        "ids:refresh: wrote spec/ids/intellij.json: 7 declared and 6 runtime IDs from IU-262.1.2, IdeaVIM 9.9.9\n",
      stderr: "",
      written: `${JSON.stringify(
        {
          ide: "IU-262.1.2",
          plugins: { IdeaVIM: "9.9.9" },
          declared: [
            "ActivateCommitToolWindow",
            "Git.Commit",
            "GoToMenu",
            "GotoClass",
            "GotoFile",
            "VimFindActionIdAction",
            "VimShortcutKeyAction",
          ],
          runtime: [
            "ActivateProblemsViewToolWindow",
            "ActivateProjectToolWindow",
            "Debug",
            "DebugClass",
            "Run",
            "RunClass",
          ],
        },
        null,
        2,
      )}\n`,
    });
  });

  test("vscode writes the dumped commands and the contributed ones, with VS Code in temporary directories", () => {
    const dir = join(base, "vscode");
    const root = specIn(dir);
    const fake = fakeVscode(dir);
    const result = refreshWith(
      fake.env,
      "vscode",
      "--root",
      root,
      "--code",
      fake.code,
      "--extension",
      "vscodevim.vim",
      "--extension",
      "vspacecode.whichkey",
    );
    const text = textOf(fake.log);
    const log = text === null ? null : JSON.parse(text);
    // VS Code ran in one temporary directory, which is gone after the run.
    const temp = dirname(log?.args?.[1] ?? "");
    expect({
      result,
      written: textOf(join(root, "ids/vscode.json")),
      log,
      tempLeft: existsSync(temp),
    }).toEqual({
      result: {
        status: 0,
        stdout:
          "ids:refresh: wrote spec/ids/vscode.json: 7 commands from VS Code 1.200.0, VSpaceCode.whichkey 0.11.4, vscodevim.vim 1.32.4\n",
        stderr: "",
      },
      written: `${JSON.stringify(
        {
          vscode: "1.200.0",
          extensions: {
            "VSpaceCode.whichkey": "0.11.4",
            "vscodevim.vim": "1.32.4",
          },
          commands: [
            "extension.vim_escape",
            "git.commit",
            "markdown.showPreview",
            "toggleVim",
            "vim.remap",
            "whichkey.show",
            "workbench.action.quickOpen",
          ],
        },
        null,
        2,
      )}\n`,
      log: {
        args: [
          "--user-data-dir",
          join(temp, "user-data"),
          "--extensions-dir",
          join(temp, "extensions"),
          "--extensionDevelopmentPath",
          join(specDir, "tools/ids/vscode-dump"),
          "--disable-gpu",
          "--disable-workspace-trust",
          "--skip-welcome",
          "--skip-release-notes",
          "--password-store=basic",
          "--new-window",
          join(temp, "workspace"),
        ],
        home: join(temp, "home"),
        xdg: [".config", ".cache", ".local/share", ".local/state"].map((name) =>
          join(temp, "home", name),
        ),
        wayland: null,
        inherited: [],
        copied: ["vscodevim.vim-1.32.4", "vspacecode.whichkey-0.11.4"],
        settings: {
          "extensions.autoCheckUpdates": false,
          "extensions.autoUpdate": false,
          "telemetry.telemetryLevel": "off",
          "update.mode": "none",
          "workbench.enableExperiments": false,
          "workbench.startupEditor": "none",
        },
      },
      tempLeft: false,
    });
  });

  test("vscode exits 2 when an extension is missing or the dump disagrees with the install", () => {
    const dir = join(base, "vscode-fails");
    const root = specIn(dir);
    const fake = fakeVscode(dir);
    const run = (env: Record<string, string>, ...extensions: string[]) =>
      refreshWith(
        { ...fake.env, ...env },
        "vscode",
        "--root",
        root,
        "--code",
        fake.code,
        ...extensions.flatMap((id) => ["--extension", id]),
      );
    const both = ["vscodevim.vim", "VSpaceCode.whichkey"];
    const appPackage = join(dir, "code/resources/app/package.json");
    const fails = (message: string) => ({
      status: 2,
      stdout: "",
      stderr: `ids:refresh: ${message}\n`,
    });
    expect([
      run({}, "vscodevim.vim", "redhat.java"),
      run({ FAKE_CODE_VERSION: "1.199.0" }, ...both),
      run({ FAKE_CODE_SKIP: "vscodevim.vim" }, ...both),
      run({ FAKE_CODE_NO_DUMP: "1" }, ...both),
      textOf(join(root, "ids/vscode.json")),
    ]).toEqual([
      fails(`${join(fake.home, ".vscode/extensions")} has no redhat.java`),
      fails(`the dump is of VS Code 1.199.0, but ${appPackage} has 1.200.0`),
      fails("vscodevim.vim 1.32.4 did not activate in VS Code"),
      {
        status: 2,
        stdout: "",
        stderr: [
          "ids:refresh: VS Code wrote no command IDs; the end of its output:",
          "ids:refresh: [main] Window failed to load",
          "",
        ].join("\n"),
      },
      null,
    ]);
  });

  test(
    "vscode lets the processes that outlive VS Code finish their own shutdown",
    SLOW,
    () => {
      const dir = join(base, "vscode-shutdown");
      const root = specIn(dir);
      const fake = fakeVscode(dir);
      const xvfb = fakeXvfbRun(dir, fake.env.PATH);
      const { status, stderr } = refreshWith(
        { ...fake.env, ...xvfb.env },
        "vscode",
        "--root",
        root,
        "--code",
        fake.code,
        "--extension",
        "vscodevim.vim",
      );
      expect({ status, stderr, left: readdirSync(xvfb.tmp) }).toEqual({
        status: 0,
        stderr: "",
        left: [],
      });
    },
  );

  test.each([
    { signal: "SIGINT", status: 130, vscode: "quits on SIGTERM", env: {} },
    { signal: "SIGTERM", status: 143, vscode: "quits on SIGTERM", env: {} },
    { signal: "SIGHUP", status: 129, vscode: "quits on SIGTERM", env: {} },
    {
      signal: "SIGINT",
      status: 130,
      vscode: "ignores SIGTERM",
      env: { FAKE_CODE_IGNORE_TERM: "1" },
    },
  ] as const)(
    "vscode stopped by $signal ends VS Code, which $vscode, removes the temporary directories and exits $status",
    SLOW,
    async ({ signal, status, vscode, env }) => {
      const dir = join(base, `vscode-${signal}-${vscode.split(" ")[0]}`);
      const root = specIn(dir);
      const fake = fakeVscode(dir);
      const xvfb = fakeXvfbRun(dir, fake.env.PATH);
      const pid = join(dir, "code.pid");
      const run = startWith(
        { ...fake.env, ...xvfb.env, ...env, FAKE_CODE_HANG: pid },
        "vscode",
        "--root",
        root,
        "--code",
        fake.code,
        "--extension",
        "vscodevim.vim",
      );
      onTestFinished(() => {
        // Nothing outlives a failed run.
        run.child.kill("SIGKILL");
        signalGroupIn(xvfb.group, "SIGKILL");
      });
      const started = await eventually(
        () => existsSync(pid) || run.child.exitCode !== null,
        30_000,
      );
      run.child.kill(signal);
      const result = await run.exited;
      const ended = await eventually(
        () => !signalGroupIn(xvfb.group, 0),
        10_000,
      );
      expect({
        started: started && existsSync(pid),
        result,
        ended,
        left: readdirSync(xvfb.tmp),
        written: textOf(join(root, "ids/vscode.json")),
      }).toEqual({
        started: true,
        result: {
          status,
          stdout: "",
          stderr: `ids:refresh: interrupted by ${signal}\n`,
        },
        ended: true,
        left: [],
        written: null,
      });
    },
  );
});
