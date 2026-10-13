// A small catalog that passes every validator rule. It uses each part of the entry shape, so a test
// can break one rule by changing one field of a fresh copy.
import { join } from "node:path";
import { readSchemas } from "../../tools/catalog-files.mts";
import type {
  Catalog,
  CtrlKey,
  Entry,
  Group,
  VscodeBinding,
} from "../../tools/core/catalog.mts";
import type { SchemaSet } from "../../tools/core/validate.mts";

export type MiniCatalogFiles = {
  commands: { path: string; data: { $schema: string; commands: Entry[] } }[];
  groups: { path: string; data: { $schema: string; groups: Group[] } };
  ctrlKeys: { path: string; data: { $schema: string; keys: CtrlKey[] } };
  retiredIds: { path: string; data: { $schema: string; ids: string[] } };
};

/** An entry with the text fields filled in; `category` comes from the id. */
function entry(
  fields: Pick<Entry, "id" | "keys" | "label"> & Partial<Entry>,
): Entry {
  return {
    category: fields.id.slice(0, fields.id.indexOf(".")),
    description: `${fields.label} in the active editor.`,
    examples: [`${fields.label} → done`],
    rationale: "Doom Emacs and LazyVim use the same key.",
    stage: "stable",
    verifiedAgainst: {
      vscode: "1.141.0",
      vscodevim: "1.32.4",
      intellij: "2026.2.3",
      ideavim: "2.47.3",
    },
    ...fields,
  };
}

function command(
  id: string,
  exit: VscodeBinding["exit"] = "input",
  count: VscodeBinding["count"] = "none",
): VscodeBinding {
  return { exec: { command: id }, exit, repeatable: false, count };
}

function commandsFile(stem: string, commands: Entry[]) {
  return {
    path: `spec/catalog/commands/${stem}.json`,
    data: { $schema: "../../schema/commands.schema.json", commands },
  };
}

/** A fresh copy, with the command files in path order. */
export function miniCatalogFiles(): MiniCatalogFiles {
  return {
    commands: [
      commandsFile("code", [
        entry({
          id: "code.action",
          keys: { vim: ["gra"], leader: ["SPC c q"] },
          label: "Show code actions",
          modes: ["n", "x"],
          vscode: command("editor.action.quickFix"),
          intellij: { action: "ShowIntentionActions" },
          deviation: {
            shadows: "Vim gr{char}, which neither engine implements",
            origin: "Neovim 0.11 default mapping",
            note: "Clashes with the gr of ReplaceWithRegister.",
          },
        }),
        entry({
          id: "code.hover",
          keys: { vim: ["K"], leader: ["SPC c d"] },
          label: "Show documentation",
          vscode: command("editor.action.showHover", "editor"),
          intellij: { ideavimKeys: "K" },
          semantics: { ideavim: "Runs IdeaVim K, the quick documentation." },
          deviation: {
            shadows: "Vim K, which looks the word up with keywordprg",
            origin: "Neovim LSP default mapping",
            note: "VS Code shows the hover instead.",
          },
        }),
        entry({
          id: "code.comment",
          keys: { leader: ["SPC c c"] },
          label: "Toggle line comment",
          vscode: {
            exec: { command: "editor.action.commentLine" },
            exit: "editor",
            repeatable: true,
            count: "repeat",
          },
          intellij: { ideavimKeys: "gcc", provider: "commentary" },
          semantics: { ideavim: "Runs gcc of the commentary extension." },
        }),
      ]),
      commandsFile("diag", [
        entry({
          id: "diag.next",
          keys: { vim: ["]d"] },
          label: "Go to next problem",
          aliases: [{ keys: { vim: ["]e"] }, until: "1.0.0" }],
          vscode: command("editor.action.marker.next", "editor", "repeat"),
          intellij: { action: "GotoNextError", motionSafe: false },
          deviation: {
            shadows: "Nothing in Vim",
            origin: "Neovim 0.10 default mapping",
            note: "Moves by problem, not by diff hunk.",
          },
        }),
      ]),
      commandsFile("file", [
        entry({
          id: "file.find",
          keys: { leader: ["SPC f f", "SPC SPC"] },
          label: "Find file",
          vscode: command("workbench.action.quickOpen"),
          intellij: { action: "GotoFile" },
        }),
        entry({
          id: "file.recent",
          keys: { leader: ["SPC f r"] },
          label: "Open recent file",
          vscode: {
            exec: { command: "workbench.action.quickOpen", args: ["recent"] },
            exit: "input",
            repeatable: false,
            count: "none",
          },
          intellij: { action: "RecentFiles" },
          support: {
            vscode: { level: "partial", note: "Lists open editors too." },
          },
        }),
      ]),
      commandsFile("git", [
        entry({
          id: "git.status",
          keys: { leader: ["SPC g g"] },
          label: "Show Git changes",
          stage: "experimental",
          vscode: command("workbench.view.scm"),
          intellij: { action: "ActivateCommitToolWindow" },
        }),
      ]),
      commandsFile("search", [
        entry({
          id: "search.project",
          keys: { leader: ["SPC /"] },
          label: "Search in project",
          modes: ["n", "x"],
          aliases: [{ keys: { leader: ["SPC f s"] }, until: "1.0.0" }],
          vscode: command("workbench.action.findInFiles"),
          intellij: { action: "FindInPath" },
        }),
      ]),
      commandsFile("window", [
        entry({
          id: "window.focus-left",
          keys: { leader: ["SPC w h"] },
          label: "Focus split left",
          vscode: command(
            "workbench.action.focusLeftGroup",
            "editor",
            "repeat",
          ),
          intellij: { ideavimKeys: "<C-w>h" },
          semantics: { ideavim: "Runs IdeaVim <C-w>h." },
        }),
        entry({
          id: "window.only",
          keys: { leader: ["SPC w o"] },
          label: "Close other splits",
          vscode: {
            exec: { vimKeys: "<C-w>o" },
            exit: "editor",
            repeatable: false,
            count: "none",
          },
          intellij: { action: "UnsplitAll" },
          semantics: { vscodevim: "Runs VSCodeVim <C-w>o." },
        }),
        entry({
          id: "window.move-left",
          keys: { leader: ["SPC w m h"] },
          label: "Move split left",
          vscode: command(
            "workbench.action.moveActiveEditorGroupLeft",
            "editor",
          ),
          support: {
            intellij: { level: "none", note: "No action moves a split." },
          },
        }),
      ]),
    ],
    groups: {
      path: "spec/catalog/groups.json",
      data: {
        $schema: "../schema/groups.schema.json",
        groups: [
          { keys: "SPC c", label: "Code" },
          { keys: "SPC f", label: "File" },
          { keys: "SPC g", label: "Git" },
          { keys: "SPC w", label: "Window" },
          { keys: "SPC w m", label: "Move" },
        ],
      },
    },
    ctrlKeys: {
      path: "spec/catalog/ctrl-keys.json",
      data: {
        $schema: "../schema/ctrl-keys.schema.json",
        keys: [
          { key: "<C-a>", handler: "a:vim" },
          { key: "<C-c>", handler: "a:vim x:ide", mac: "a:vim" },
        ],
      },
    },
    retiredIds: {
      path: "spec/catalog/retired-ids.json",
      data: { $schema: "../schema/retired-ids.schema.json", ids: ["file.old"] },
    },
  };
}

/** The catalog of the files as validateCatalog returns it: the entries in file path order. */
export function miniCatalog(files = miniCatalogFiles()): Catalog {
  return {
    entries: files.commands.flatMap((file) => file.data.commands),
    groups: files.groups.data.groups,
    ctrlKeys: files.ctrlKeys.data.keys,
    retiredIds: files.retiredIds.data.ids,
  };
}

/**
 * A further entry that passes every rule once it is in the file of its category, if its leader
 * key is free and its prefix has a group.
 */
export function newEntry(id: string, leader: string, label: string): Entry {
  return entry({
    id,
    keys: { leader: [leader] },
    label,
    vscode: command("workbench.action.files.save", "editor"),
    intellij: { action: "SaveAll" },
  });
}

/** The command file of a category. */
export function fileOf(files: MiniCatalogFiles, stem: string) {
  const found = files.commands.find((file) =>
    file.path.endsWith(`/${stem}.json`),
  );
  if (!found) throw new Error(`no ${stem}.json in the mini catalog`);
  return found;
}

/** The entry with this id, to change in place. */
export function entryOf(files: MiniCatalogFiles, id: string): Entry {
  const found = files.commands
    .flatMap((file) => file.data.commands)
    .find((entry) => entry.id === id);
  if (!found) throw new Error(`no entry ${id} in the mini catalog`);
  return found;
}

/** The schemas in spec/schema by file name. */
export function loadSchemas(): SchemaSet {
  return readSchemas(join(import.meta.dirname, "../.."));
}
