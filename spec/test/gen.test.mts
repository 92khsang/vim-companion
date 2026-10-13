import { describe, expect, test } from "vitest";
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
});

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
