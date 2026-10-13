import { describe, expect, test } from "vitest";
import { validateCatalog } from "../tools/core/validate.mts";
import {
  entryOf,
  loadSchemas,
  miniCatalogFiles,
} from "./support/mini-catalog.mts";

const schemas = loadSchemas();

describe("validateCatalog", () => {
  test("returns the catalog of valid files, with the entries in file path order", () => {
    const files = miniCatalogFiles();
    const ids = [
      "code.action",
      "code.hover",
      "code.comment",
      "diag.next",
      "file.find",
      "file.recent",
      "git.status",
      "search.project",
      "window.focus-left",
      "window.only",
      "window.move-left",
    ];
    const result = validateCatalog(files, schemas);
    expect(result).toEqual({
      catalog: {
        entries: ids.map((id) => entryOf(files, id)),
        groups: files.groups.data.groups,
        ctrlKeys: files.ctrlKeys.data.keys,
        retiredIds: files.retiredIds.data.ids,
      },
      diagnostics: [],
    });
    const reversed = { ...files, commands: [...files.commands].reverse() };
    expect(validateCatalog(reversed, schemas)).toEqual(result);
  });
});
