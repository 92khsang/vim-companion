import { spawnSync } from "node:child_process";
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
import { afterAll, describe, expect, test } from "vitest";
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
    '#!/bin/sh\n[ "$1" = "-a" ] && shift\nexec "$@"\n',
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
 * removes it a little while after SIGTERM. The lock file is in `tmp`, the TMPDIR of the run, so
 * that `tmp` is empty once everything has shut down. `path` is the PATH to put it in front of.
 */
function fakeXvfbRun(dir: string, path: string) {
  const bin = join(dir, "xvfb");
  const tmp = join(dir, "tmp");
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
      '[ "$1" = "-a" ] && shift',
      "trap 'kill \"$server\"' EXIT",
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
  return { tmp, env: { PATH: `${bin}:${path}`, TMPDIR: tmp } };
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
      fails(
        "VS Code wrote no command IDs; the end of its output:\n[main] Window failed to load",
      ),
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
});
