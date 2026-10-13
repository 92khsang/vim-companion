import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { IntellijIds, VscodeIds } from "../tools/core/ids.mts";
import {
  entryOf,
  miniCatalogFiles,
  type MiniCatalogFiles,
} from "./support/mini-catalog.mts";

const specDir = join(import.meta.dirname, "..");
const cli = join(specDir, "tools/check-ids.mts");
const base = mkdtempSync(join(tmpdir(), "check-ids-"));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Every VS Code command of the mini catalog, and the command that pnpm gen writes. */
const VSCODE: VscodeIds = {
  vscode: "1.141.0",
  extensions: { "VSpaceCode.whichkey": "0.11.4", "vscodevim.vim": "1.32.4" },
  commands: [
    "editor.action.commentLine",
    "editor.action.marker.next",
    "editor.action.quickFix",
    "editor.action.showHover",
    "whichkey.show",
    "workbench.action.findInFiles",
    "workbench.action.focusLeftGroup",
    "workbench.action.moveActiveEditorGroupLeft",
    "workbench.action.quickOpen",
    "workbench.view.scm",
  ],
};

/** Every IntelliJ action of the mini catalog. */
const INTELLIJ: IntellijIds = {
  ide: "IU-262.10968.63",
  plugins: { IdeaVIM: "2.47.3" },
  declared: [
    "FindInPath",
    "GotoFile",
    "GotoNextError",
    "RecentFiles",
    "ShowIntentionActions",
    "UnsplitAll",
  ],
  runtime: [
    "ActivateCommitToolWindow",
    "Debug",
    "DebugClass",
    "Run",
    "RunClass",
  ],
};

/**
 * Writes the catalog, the real schemas and the ID snapshots to <base>/<name>/spec and returns that
 * directory.
 */
function writeSpec(
  name: string,
  files: MiniCatalogFiles,
  ids: { vscode: unknown; intellij: unknown } = {
    vscode: VSCODE,
    intellij: INTELLIJ,
  },
): string {
  const root = join(base, name, "spec");
  cpSync(join(specDir, "schema"), join(root, "schema"), { recursive: true });
  for (const { path, data } of [
    ...files.commands,
    files.groups,
    files.ctrlKeys,
    files.retiredIds,
    { path: "spec/ids/vscode.json", data: ids.vscode },
    { path: "spec/ids/intellij.json", data: ids.intellij },
  ]) {
    const file = join(base, name, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  return root;
}

function checkIds(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [cli, ...args],
    { encoding: "utf8" },
  );
  return { status, stdout, stderr };
}

describe("check-ids", () => {
  test("prints the summary and exits 0 when every ID resolves", () => {
    const root = writeSpec("valid", miniCatalogFiles());
    expect(checkIds("--root", root)).toEqual({
      status: 0,
      stdout:
        "check-ids: resolved 11/11 VS Code commands and 7/7 IntelliJ actions; unsupported entries: VS Code 0, IntelliJ 1\n",
      stderr: "",
    });
  });

  test("prints the unknown IDs as sorted lines with suggestions, then the summary, and exits 1", () => {
    const files = miniCatalogFiles();
    entryOf(files, "window.move-left").vscode!.exec = {
      command: "workbench.action.moveActiveEditorGroupLft",
    };
    entryOf(files, "file.find").intellij = { action: "GotoFle" };
    const root = writeSpec("unknown", files);
    // From "GotoFle": GotoFile 1, Debug 7, Run 7, RecentFiles 8. From the VS Code command:
    // moveActiveEditorGroupLeft 1, focusLeftGroup 15, findInFiles 22, quickOpen 22.
    expect(checkIds("--root", root)).toEqual({
      status: 1,
      stdout: [
        'spec/catalog/commands/file.json: file.find: intellij.action "GotoFle" is not in spec/ids/intellij.json (did you mean "GotoFile", "Debug" or "Run"?)',
        'spec/catalog/commands/window.json: window.move-left: vscode.exec.command "workbench.action.moveActiveEditorGroupLft" is not in spec/ids/vscode.json (did you mean "workbench.action.moveActiveEditorGroupLeft", "workbench.action.focusLeftGroup" or "workbench.action.findInFiles"?)',
        "check-ids: resolved 10/11 VS Code commands and 6/7 IntelliJ actions; unsupported entries: VS Code 0, IntelliJ 1",
        "",
      ].join("\n"),
      stderr: "",
    });
  });
});
