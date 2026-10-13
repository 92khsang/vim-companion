import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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

function refresh(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [cli, ...args],
    { encoding: "utf8", env: { ...process.env, HOME: home } },
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
});
