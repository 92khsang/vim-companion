// Small fixture files that pass validateFixtures: the mini catalog inline and a few cases of each
// set. A test can break one check by changing one field of a fresh copy.
import type {
  CatalogFixture,
  HintViewFixture,
  VersionOrderFixture,
} from "../../tools/core/fixtures.mts";
import { miniCatalog } from "./mini-catalog.mts";

export type MiniFixtureFiles = {
  catalog: { path: string; data: CatalogFixture }[];
  hintView: { path: string; data: HintViewFixture }[];
  versionOrder: { path: string; data: VersionOrderFixture };
};

/** The entries and groups of the mini catalog. */
function inlineCatalog() {
  const { entries, groups } = miniCatalog();
  return { entries, groups };
}

/** A fresh copy. */
export function miniFixtureFiles(): MiniFixtureFiles {
  return {
    catalog: [
      {
        path: "spec/fixtures/catalog/leader.json",
        data: {
          $schema: "../../schema/fixture-catalog.schema.json",
          description: "Leader keys of the mini catalog.",
          catalog: inlineCatalog(),
          cases: [
            {
              id: "root",
              ide: "vscode",
              keys: [],
              expect: { kind: "group", label: "" },
            },
            {
              id: "leaf-w-h",
              ide: "intellij",
              options: { experimental: true, version: "1.0.0" },
              keys: ["w", "h"],
              expect: {
                kind: "leaf",
                entry: "window.focus-left",
                supported: true,
              },
            },
            {
              id: "unbound-x",
              ide: "vscode",
              keys: ["x"],
              expect: { kind: "unbound" },
            },
          ],
        },
      },
    ],
    hintView: [
      {
        path: "spec/fixtures/hint-view/window.json",
        data: {
          $schema: "../../schema/fixture-hint-view.schema.json",
          description: "The Window group of the mini catalog.",
          catalog: inlineCatalog(),
          cases: [
            {
              id: "window-intellij",
              ide: "intellij",
              prefix: ["w"],
              rows: [
                {
                  key: "h",
                  label: "Focus split left",
                  group: false,
                  badge: null,
                },
                {
                  key: "o",
                  label: "Close other splits",
                  group: false,
                  badge: "differs-from-vim",
                },
                { key: "m", label: "Move", group: true, badge: null },
              ],
            },
          ],
        },
      },
    ],
    versionOrder: {
      path: "spec/fixtures/version-order.json",
      data: {
        $schema: "../schema/fixture-version-order.schema.json",
        ascending: ["0.0.0-dev.1", "0.0.0", "1.0.0"],
      },
    },
  };
}
