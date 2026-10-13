import { describe, expect, test } from "vitest";
import type { Catalog } from "../tools/core/catalog.mts";
import { genIde, whichKeyArgs } from "../tools/core/gen.mts";
import {
  entryOf,
  fileOf,
  miniCatalog,
  miniCatalogFiles,
  type MiniCatalogFiles,
} from "./support/mini-catalog.mts";

/** The mini catalog without the entries of these command files and without these groups. */
function without(
  stems: readonly string[],
  groups: readonly string[] = [],
): MiniCatalogFiles {
  const files = miniCatalogFiles();
  for (const stem of stems) fileOf(files, stem).data.commands = [];
  files.groups.data.groups = files.groups.data.groups.filter(
    ({ keys }) => !groups.includes(keys),
  );
  return files;
}

describe("genIde", () => {
  test("leaves experimental entries out of every file", () => {
    // git.status (SPC g g) is experimental in the mini catalog; diag.next (]d, alias ]e) becomes so.
    const files = miniCatalogFiles();
    entryOf(files, "diag.next").stage = "experimental";
    expect(genIde(miniCatalog(files))).toEqual(
      genIde(miniCatalog(without(["diag", "git"], ["SPC g"]))),
    );
  });

  test("keeps an alias in the versions before its until and drops it from then on", () => {
    // ]e of diag.next and SPC f s of search.project are aliases until 1.0.0.
    const noAliases = miniCatalogFiles();
    delete entryOf(noAliases, "diag.next").aliases;
    delete entryOf(noAliases, "search.project").aliases;
    const catalog = miniCatalog();
    expect([
      genIde(catalog, { version: "1.0.0-rc.1" }),
      genIde(catalog, { version: "1.0.0" }),
    ]).toEqual([genIde(catalog), genIde(miniCatalog(noAliases))]);
  });

  test("doubles each single quote inside the single-quoted strings of the rc", () => {
    const files = miniCatalogFiles();
    const entry = entryOf(files, "diag.next");
    entry.keys = { vim: ["]'"] };
    entry.label = "Go to next 'problem'";
    expect(rcLines(miniCatalog(files))).toEqual(
      expect.arrayContaining([
        "if empty(mapcheck(']''', 'n'))",
        "  nmap ]' <Action>(GotoNextError)",
        "  let g:WhichKeyDesc_vimcompanion_diag_next_v5d27 = ']'' Go to next ''problem'''",
        "  call add(g:vimcompanion_skipped, 'n ]'' diag.next')",
        "  let g:WhichKeyDesc_vimcompanion_diag_next_v5d65 = ']e Moved to ]'''",
      ]),
    );
  });

  test("writes the Normal mode block before the Visual mode block whatever the order of modes", () => {
    const files = miniCatalogFiles();
    entryOf(files, "search.project").modes = ["x", "n"];
    expect(genIde(miniCatalog(files))).toEqual(genIde(miniCatalog()));
  });

  test("leaves out a group with no leaf below it that the IDE supports", () => {
    // SPC w m holds only window.move-left, which IntelliJ does not support. In a copy, VS Code
    // does not support it instead.
    const files = miniCatalogFiles();
    const entry = entryOf(files, "window.move-left");
    entry.intellij = { action: "MoveEditorToOppositeTabGroup" };
    delete entry.vscode;
    entry.support = {
      vscode: { level: "none", note: "No command moves a split." },
    };
    const window = whichKeyMenu(miniCatalog(files)).find(
      ({ key }) => key === "w",
    );
    expect({
      intellij: rcLines(miniCatalog()).filter((line) =>
        line.startsWith("let g:WhichKeyDesc_vimcompanion_group_"),
      ),
      vscode: window?.bindings?.map(({ key }) => key),
    }).toEqual({
      intellij: [
        "let g:WhichKeyDesc_vimcompanion_group_l63 = '<leader>c Code'",
        "let g:WhichKeyDesc_vimcompanion_group_l66 = '<leader>f File'",
        "let g:WhichKeyDesc_vimcompanion_group_l77 = '<leader>w Window'",
      ],
      vscode: ["h", "o"],
    });
  });
});

/** The lines of the rc that genIde writes for the catalog. */
function rcLines(catalog: Catalog): string[] {
  return genIde(catalog).get("intellij/vim-companion.ideavimrc")!.split("\n");
}

/** A which-key menu item, as far as the tests look at it. */
type MenuItem = { key: string; bindings?: MenuItem[] };

/** The which-key menu that genIde writes for the catalog. */
function whichKeyMenu(catalog: Catalog): MenuItem[] {
  return JSON.parse(
    genIde(catalog).get("vscode/whichkey-bindings.json")!,
  ) as MenuItem[];
}

describe("whichKeyArgs", () => {
  test("passes one truthy argument that is not a list as itself and any other arguments as a list", () => {
    // which-key 0.11.4 and VSCodeVim spread a list into positional arguments and drop a falsy one.
    expect([
      whichKeyArgs([]),
      whichKeyArgs(["@"]),
      whichKeyArgs([{ kind: "refactor" }]),
      whichKeyArgs(["a", 2]),
      whichKeyArgs([["a", "b"]]),
      whichKeyArgs([0]),
      whichKeyArgs([""]),
      whichKeyArgs([false]),
      whichKeyArgs([null]),
    ]).toStrictEqual([
      {},
      { args: "@" },
      { args: { kind: "refactor" } },
      { args: ["a", 2] },
      { args: [["a", "b"]] },
      { args: [0] },
      { args: [""] },
      { args: [false] },
      { args: [null] },
    ]);
  });
});
