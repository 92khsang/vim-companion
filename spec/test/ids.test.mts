import { describe, expect, test } from "vitest";
import type {
  Diagnostic,
  Entry,
  IntellijBinding,
  VscodeExec,
} from "../tools/core/catalog.mts";
import {
  checkIds,
  suggest,
  type CommandFile,
  type IdSnapshots,
} from "../tools/core/ids.mts";
import { newEntry } from "./support/mini-catalog.mts";

const FILE = "spec/catalog/commands/file.json";
const WINDOW = "spec/catalog/commands/window.json";
const VSCODE_IDS = "spec/ids/vscode.json";
const INTELLIJ_IDS = "spec/ids/intellij.json";

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
});
