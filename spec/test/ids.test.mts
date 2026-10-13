import { describe, expect, test } from "vitest";
import type {
  Diagnostic,
  Entry,
  IntellijBinding,
  VscodeExec,
} from "../tools/core/catalog.mts";
import {
  checkIds,
  idSummary,
  mergeVscodeCommands,
  parseDescriptorIds,
  pluginVersion,
  runtimeIntellijIds,
  suggest,
  type CommandFile,
  type IdSnapshots,
} from "../tools/core/ids.mts";
import { newEntry } from "./support/mini-catalog.mts";

const FILE = "spec/catalog/commands/file.json";
const GIT = "spec/catalog/commands/git.json";
const WINDOW = "spec/catalog/commands/window.json";
const VSCODE_IDS = "spec/ids/vscode.json";
const INTELLIJ_IDS = "spec/ids/intellij.json";
const SAVE = { command: "workbench.action.files.save" };

/** An entry that runs `vscode` in VS Code and `intellij` in IntelliJ; undefined drops the block. */
function entry(
  id: string,
  vscode: VscodeExec | undefined,
  intellij: IntellijBinding | undefined,
): Entry {
  const result = newEntry(id, "SPC x", "Do it");
  if (vscode === undefined) delete result.vscode;
  else result.vscode = { ...result.vscode!, exec: vscode };
  if (intellij === undefined) delete result.intellij;
  else result.intellij = intellij;
  return result;
}

function snapshots(
  commands: string[],
  declared: string[],
  runtime: string[],
): IdSnapshots {
  return {
    vscode: {
      path: VSCODE_IDS,
      data: {
        vscode: "1.141.0",
        extensions: {
          "VSpaceCode.whichkey": "0.11.4",
          "vscodevim.vim": "1.32.4",
        },
        commands,
      },
    },
    intellij: {
      path: INTELLIJ_IDS,
      data: {
        ide: "IU-262.10968.63",
        plugins: { IdeaVIM: "2.47.3" },
        declared,
        runtime,
      },
    },
  };
}

const diagnostic = (
  file: string,
  where: string,
  code: string,
  message: string,
): Diagnostic => ({ file, where, code, message });

describe("suggest", () => {
  test("returns the three known IDs nearest by edit distance, ties in code-unit order", () => {
    // Distances from "abcz": abc 1, abcd 1, ab 2, abd 2, xbc 2, zzzz 3.
    const known = ["zzzz", "xbc", "abd", "abcd", "abc", "ab"];
    expect([
      suggest("abcz", known),
      suggest("x", ["b", "a"]),
      suggest("x", []),
    ]).toEqual([["abc", "abcd", "ab"], ["a", "b"], []]);
  });
});

describe("checkIds", () => {
  test("reports a VS Code command that the snapshot lacks, with the nearest known commands", () => {
    const files: CommandFile[] = [
      {
        path: WINDOW,
        data: {
          commands: [
            entry(
              "window.only",
              { vimKeys: "<C-w>o" },
              { action: "UnsplitAll" },
            ),
            entry("window.move-left", undefined, { action: "UnsplitAll" }),
          ],
        },
      },
      {
        path: FILE,
        data: {
          commands: [
            entry(
              "file.find",
              { command: "workbench.action.quickOpn" },
              { action: "GotoFile" },
            ),
            entry(
              "file.save",
              { command: "workbench.action.files.save" },
              { action: "SaveAll" },
            ),
          ],
        },
      },
    ];
    const ids = snapshots(
      [
        "whichkey.show",
        "workbench.action.files.save",
        "workbench.action.quickOpen",
      ],
      ["GotoFile", "SaveAll", "UnsplitAll"],
      [],
    );
    // From "workbench.action.quickOpn": quickOpen 1, files.save at most 10, whichkey.show at least 12.
    expect(checkIds(files, ids, ["whichkey.show"])).toEqual([
      diagnostic(
        FILE,
        "file.find",
        "UNKNOWN_COMMAND",
        'vscode.exec.command "workbench.action.quickOpn" is not in spec/ids/vscode.json (did you mean "workbench.action.quickOpen", "workbench.action.files.save" or "whichkey.show"?)',
      ),
    ]);
  });

  test("reports an IntelliJ action that neither the declared nor the runtime IDs have, sorted by file", () => {
    const files: CommandFile[] = [
      {
        path: WINDOW,
        data: {
          commands: [
            entry("window.only", SAVE, { action: "UnsplitAl" }),
            entry("window.focus-left", SAVE, { ideavimKeys: "<C-w>h" }),
            entry("window.move-left", SAVE, undefined),
          ],
        },
      },
      {
        path: GIT,
        data: {
          commands: [
            entry("git.status", SAVE, { action: "ActivateCommitToolWindow" }),
          ],
        },
      },
      {
        path: FILE,
        data: {
          commands: [
            entry("file.find", SAVE, { action: "GotoFle" }),
            entry("file.save", SAVE, { action: "SaveAll" }),
          ],
        },
      },
    ];
    const ids = snapshots(
      ["whichkey.show", "workbench.action.files.save"],
      ["GotoFile", "SaveAll", "UnsplitAll"],
      ["ActivateCommitToolWindow", "Run"],
    );
    // From "GotoFle": GotoFile 1, SaveAll 6, Run 7, UnsplitAll 9, ActivateCommitToolWindow 20.
    // From "UnsplitAl": UnsplitAll 1, GotoFile 8, SaveAll 8, Run 9, ActivateCommitToolWindow 21.
    expect(checkIds(files, ids, ["whichkey.show"])).toEqual([
      diagnostic(
        FILE,
        "file.find",
        "UNKNOWN_ACTION",
        'intellij.action "GotoFle" is not in spec/ids/intellij.json (did you mean "GotoFile", "SaveAll" or "Run"?)',
      ),
      diagnostic(
        WINDOW,
        "window.only",
        "UNKNOWN_ACTION",
        'intellij.action "UnsplitAl" is not in spec/ids/intellij.json (did you mean "UnsplitAll", "GotoFile" or "SaveAll"?)',
      ),
    ]);
  });

  test("reports a command that pnpm gen writes and the VS Code snapshot lacks", () => {
    const files: CommandFile[] = [
      {
        path: FILE,
        data: { commands: [entry("file.save", SAVE, { action: "SaveAll" })] },
      },
    ];
    const ids = snapshots(
      ["whichkey.show", "workbench.action.files.save"],
      ["SaveAll"],
      [],
    );
    // From "vim.remap": whichkey.show at most 13, workbench.action.files.save at least 18.
    expect(checkIds(files, ids, ["whichkey.show", "vim.remap"])).toEqual([
      diagnostic(
        VSCODE_IDS,
        "vim.remap",
        "UNKNOWN_COMMAND",
        'pnpm gen writes this command, but the snapshot lacks it (did you mean "whichkey.show" or "workbench.action.files.save"?)',
      ),
    ]);
  });

  test("names one suggestion, or none, when a snapshot has fewer IDs", () => {
    const files: CommandFile[] = [
      {
        path: FILE,
        data: {
          commands: [
            entry(
              "file.find",
              { command: "workbench.action.quickOpn" },
              { action: "GotoFle" },
            ),
          ],
        },
      },
    ];
    expect(checkIds(files, snapshots([], ["GotoFile"], []), [])).toEqual([
      diagnostic(
        FILE,
        "file.find",
        "UNKNOWN_ACTION",
        'intellij.action "GotoFle" is not in spec/ids/intellij.json (did you mean "GotoFile"?)',
      ),
      diagnostic(
        FILE,
        "file.find",
        "UNKNOWN_COMMAND",
        'vscode.exec.command "workbench.action.quickOpn" is not in spec/ids/vscode.json',
      ),
    ]);
  });
});

describe("idSummary", () => {
  test("counts the resolved IDs of each IDE and the entries without an IDE block", () => {
    const files: CommandFile[] = [
      {
        path: WINDOW,
        data: {
          commands: [
            entry(
              "window.only",
              { vimKeys: "<C-w>o" },
              { action: "UnsplitAll" },
            ),
            entry("window.focus-left", SAVE, { ideavimKeys: "<C-w>h" }),
            entry("window.move-left", SAVE, undefined),
          ],
        },
      },
      {
        path: FILE,
        data: {
          commands: [
            entry("file.find", SAVE, { action: "GotoFile" }),
            entry("file.reveal", undefined, { action: "SelectInProjectView" }),
            entry("file.save", SAVE, { action: "SaveAll" }),
          ],
        },
      },
    ];
    // VS Code: 4 entry commands and 2 generated commands; IntelliJ: 4 actions.
    const found = [
      diagnostic(FILE, "file.find", "UNKNOWN_COMMAND", "unknown"),
      diagnostic(FILE, "file.find", "UNKNOWN_ACTION", "unknown"),
      diagnostic(VSCODE_IDS, "vim.remap", "UNKNOWN_COMMAND", "unknown"),
    ];
    expect(idSummary(files, ["whichkey.show", "vim.remap"], found)).toBe(
      "check-ids: resolved 4/6 VS Code commands and 3/4 IntelliJ actions; unsupported entries: VS Code 1, IntelliJ 1",
    );
  });
});

describe("parseDescriptorIds", () => {
  test("collects the IDs of actions, groups and tool windows outside XML comments", () => {
    const xml = [
      "<idea-plugin>",
      "  <actions>",
      '    <action id="GotoFile" class="com.intellij.ide.actions.GotoFileAction"/>',
      '    <group id="GoToMenu" popup="true">',
      '      <action class="com.intellij.ide.actions.SaveAllAction"',
      '              id="SaveAll" text="Save All"/>',
      '      <reference ref="GotoClass"/>',
      '      <add-to-group group-id="EditMenu"/>',
      "    </group>",
      '    <!-- <action id="Console.TableResult.Find"/> -->',
      '    <action id="GotoFile"/>',
      "  </actions>",
      '  <extensions defaultExtensionNs="com.intellij">',
      '    <toolWindow id="Backup and Sync History" factoryClass="a.B"/>',
      '    <toolWindow factoryClass="a.C" id="Project"/>',
      "  </extensions>",
      "</idea-plugin>",
    ].join("\n");
    expect(parseDescriptorIds(xml)).toEqual({
      ids: ["GoToMenu", "GotoFile", "SaveAll"],
      toolWindows: ["Backup and Sync History", "Project"],
    });
  });
});

describe("runtimeIntellijIds", () => {
  test("derives the tool window and executor actions that no descriptor declares", () => {
    const toolWindows = [
      "Project",
      "Backup and Sync History",
      "Commit",
      "Problems View",
      "Project",
    ];
    expect(
      runtimeIntellijIds(toolWindows, ["ActivateCommitToolWindow", "GotoFile"]),
    ).toEqual([
      "ActivateBackupandSyncHistoryToolWindow",
      "ActivateProblemsViewToolWindow",
      "ActivateProjectToolWindow",
      "Debug",
      "DebugClass",
      "Run",
      "RunClass",
    ]);
  });
});

describe("mergeVscodeCommands", () => {
  test("unites the dump with the contributed and key-bound commands, without internal IDs or removal dashes", () => {
    const manifests: unknown[] = [
      {
        name: "markdown-language-features",
        contributes: {
          commands: [
            { command: "markdown.showPreview", title: "Open Preview" },
            { command: "_markdown.copyImage", title: "Copy Image" },
          ],
          keybindings: [
            { command: "markdown.showPreview", key: "ctrl+shift+v" },
            { key: "f1" },
          ],
        },
      },
      {
        name: "vim",
        contributes: {
          commands: [{ command: "toggleVim", title: "Vim: Toggle Vim Mode" }],
          keybindings: [
            { command: "-editor.action.selectAll", key: "ctrl+a" },
            { command: "extension.vim_escape", key: "escape" },
          ],
        },
      },
      { name: "theme-defaults" },
      // A manifest may contribute one command or key binding as an object instead of an array.
      {
        name: "git",
        contributes: {
          commands: { command: "git.openChange", title: "Open Changes" },
          keybindings: { command: "git.commit", key: "ctrl+enter" },
        },
      },
    ];
    const dumped = [
      "workbench.action.quickOpen",
      "vim.remap",
      "markdown.showPreview",
    ];
    expect(mergeVscodeCommands(dumped, manifests)).toEqual([
      "editor.action.selectAll",
      "extension.vim_escape",
      "git.commit",
      "git.openChange",
      "markdown.showPreview",
      "toggleVim",
      "vim.remap",
      "workbench.action.quickOpen",
    ]);
  });
});

describe("pluginVersion", () => {
  test("reads the version of a plugin descriptor outside comments", () => {
    const xml = [
      '<idea-plugin url="https://github.com/JetBrains/ideavim">',
      "  <!-- <version>0.0.1</version> -->",
      "  <id>IdeaVIM</id>",
      '  <idea-version since-build="253"/>',
      "  <version>",
      "    2.47.3",
      "  </version>",
      "</idea-plugin>",
    ].join("\n");
    expect([
      pluginVersion(xml),
      pluginVersion("<idea-plugin><id>NoVersion</id></idea-plugin>"),
    ]).toEqual(["2.47.3", undefined]);
  });
});
