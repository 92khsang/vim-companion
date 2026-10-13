import { describe, expect, test } from "vitest";
import type { Ide, KeyCatalog } from "../tools/core/catalog.mts";
import type { ResolveOptions } from "../tools/core/resolve.mts";
import { rows, type Badge, type Row } from "../tools/core/rows.mts";
import { miniCatalog } from "./support/mini-catalog.mts";

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
});
