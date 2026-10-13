import { describe, expect, test } from "vitest";
import type { Ide, KeyCatalog } from "../tools/core/catalog.mts";
import type { ResolveOptions } from "../tools/core/resolve.mts";
import { rows, type Badge, type Row } from "../tools/core/rows.mts";
import { validateCatalog } from "../tools/core/validate.mts";
import {
  entryOf,
  loadSchemas,
  miniCatalog,
  miniCatalogFiles,
} from "./support/mini-catalog.mts";

type Case = {
  ide: Ide;
  prefix: string[];
  options?: ResolveOptions;
  rows: Row[];
};

/** Lists the rows of each case; one comparison shows every case with other rows. */
function expectRows(cases: Case[], catalog: KeyCatalog = miniCatalog()) {
  expect(
    cases.map((c) => ({
      ...c,
      rows: rows(catalog, c.ide, c.prefix, c.options),
    })),
  ).toEqual(cases);
}

const leaf = (key: string, label: string, badge: Badge = null): Row => ({
  key,
  label,
  group: false,
  badge,
});

const group = (key: string, label: string): Row => ({
  key,
  label,
  group: true,
  badge: null,
});

describe("rows", () => {
  test("lists the entries at a leader prefix by key, with their labels", () => {
    expectRows([
      {
        ide: "vscode",
        prefix: ["c"],
        rows: [
          leaf("c", "Toggle line comment"),
          leaf("d", "Show documentation"),
          leaf("q", "Show code actions"),
        ],
      },
      { ide: "vscode", prefix: ["w", "h"], rows: [] },
      { ide: "intellij", prefix: ["x"], rows: [] },
    ]);
  });

  test("lists the groups that have a bound leaf below them after the entries, by key", () => {
    expectRows([
      {
        ide: "vscode",
        prefix: [],
        rows: [
          leaf("SPC", "Find file"),
          leaf("/", "Search in project"),
          group("c", "Code"),
          group("f", "File"),
          group("w", "Window"),
        ],
      },
      {
        ide: "intellij",
        prefix: [],
        options: { experimental: true },
        rows: [
          leaf("SPC", "Find file"),
          leaf("/", "Search in project"),
          group("c", "Code"),
          group("f", "File"),
          group("g", "Git"),
          group("w", "Window"),
        ],
      },
    ]);
  });

  test('lists the active aliases after the entries, by key, as "Moved to <primary key>"', () => {
    expectRows([
      {
        ide: "intellij",
        prefix: ["f"],
        rows: [
          leaf("f", "Find file"),
          leaf("r", "Open recent file"),
          leaf("s", "Moved to SPC /"),
        ],
      },
    ]);
    // Aliases whose keys sort before an entry key or after a group key.
    const files = miniCatalogFiles();
    entryOf(files, "file.find").aliases = [
      { keys: { leader: ["SPC z"] }, until: "2.0.0" },
    ];
    entryOf(files, "search.project").aliases = [
      { keys: { leader: ["SPC f s", "SPC f a"] }, until: "1.0.0" },
    ];
    expect(validateCatalog(files, loadSchemas()).diagnostics).toEqual([]);
    expectRows(
      [
        {
          ide: "intellij",
          prefix: ["f"],
          rows: [
            leaf("f", "Find file"),
            leaf("r", "Open recent file"),
            leaf("a", "Moved to SPC /"),
            leaf("s", "Moved to SPC /"),
          ],
        },
        {
          ide: "intellij",
          prefix: ["f"],
          options: { version: "1.0.0" },
          rows: [leaf("f", "Find file"), leaf("r", "Open recent file")],
        },
        {
          ide: "vscode",
          prefix: [],
          options: { version: "1.0.0" },
          rows: [
            leaf("SPC", "Find file"),
            leaf("/", "Search in project"),
            leaf("z", "Moved to SPC f f"),
            group("c", "Code"),
            group("f", "File"),
            group("w", "Window"),
          ],
        },
      ],
      miniCatalog(files),
    );
  });

  test("gives each row the badge of highest precedence for the IDE: unsupported, experimental, fallback, differs-from-vim", () => {
    expectRows([
      {
        ide: "intellij",
        prefix: ["w"],
        rows: [
          leaf("h", "Focus split left", "differs-from-vim"),
          leaf("o", "Close other splits"),
          group("m", "Move"),
        ],
      },
      {
        ide: "vscode",
        prefix: ["w"],
        rows: [
          leaf("h", "Focus split left"),
          leaf("o", "Close other splits", "differs-from-vim"),
          group("m", "Move"),
        ],
      },
      {
        ide: "intellij",
        prefix: ["w", "m"],
        rows: [leaf("h", "Move split left", "unsupported")],
      },
      {
        ide: "vscode",
        prefix: ["w", "m"],
        rows: [leaf("h", "Move split left")],
      },
      {
        ide: "vscode",
        prefix: ["f"],
        rows: [
          leaf("f", "Find file"),
          leaf("r", "Open recent file", "fallback"),
          leaf("s", "Moved to SPC /"),
        ],
      },
      {
        ide: "intellij",
        prefix: ["g"],
        options: { experimental: true },
        rows: [leaf("g", "Show Git changes", "experimental")],
      },
    ]);
    // Entries to which two badges apply; an alias shows the badge of its entry.
    const files = miniCatalogFiles();
    entryOf(files, "window.move-left").stage = "experimental";
    entryOf(files, "git.status").support = {
      vscode: { level: "partial", note: "Shows one repository." },
    };
    entryOf(files, "window.focus-left").support = {
      intellij: { level: "partial", note: "Stays in the editor area." },
    };
    entryOf(files, "code.comment").stage = "experimental";
    entryOf(files, "search.project").support = {
      intellij: { level: "partial", note: "Searches the project only." },
    };
    expect(validateCatalog(files, loadSchemas()).diagnostics).toEqual([]);
    expectRows(
      [
        {
          ide: "intellij",
          prefix: ["w", "m"],
          options: { experimental: true },
          rows: [leaf("h", "Move split left", "unsupported")],
        },
        {
          ide: "vscode",
          prefix: ["w", "m"],
          options: { experimental: true },
          rows: [leaf("h", "Move split left", "experimental")],
        },
        {
          ide: "vscode",
          prefix: ["g"],
          options: { experimental: true },
          rows: [leaf("g", "Show Git changes", "experimental")],
        },
        {
          ide: "intellij",
          prefix: ["w"],
          options: { experimental: true },
          rows: [
            leaf("h", "Focus split left", "fallback"),
            leaf("o", "Close other splits"),
            group("m", "Move"),
          ],
        },
        {
          ide: "intellij",
          prefix: ["c"],
          options: { experimental: true },
          rows: [
            leaf("c", "Toggle line comment", "experimental"),
            leaf("d", "Show documentation", "differs-from-vim"),
            leaf("q", "Show code actions"),
          ],
        },
        {
          ide: "intellij",
          prefix: ["f"],
          rows: [
            leaf("f", "Find file"),
            leaf("r", "Open recent file"),
            leaf("s", "Moved to SPC /", "fallback"),
          ],
        },
      ],
      miniCatalog(files),
    );
  });
});
