import { describe, expect, test } from "vitest";
import type { Ide, KeyCatalog } from "../tools/core/catalog.mts";
import {
  resolve,
  type Resolution,
  type ResolveOptions,
} from "../tools/core/resolve.mts";
import { miniCatalog } from "./support/mini-catalog.mts";

type Case = {
  ide: Ide;
  keys: string[];
  options?: ResolveOptions;
  result: Resolution;
};

/** Resolves the keys of each case; one comparison shows every case with another result. */
function expectResults(cases: Case[], catalog: KeyCatalog = miniCatalog()) {
  expect(
    cases.map((c) => ({
      ...c,
      result: resolve(catalog, c.ide, c.keys, c.options),
    })),
  ).toEqual(cases);
}

describe("resolve", () => {
  test("returns the root group for no keys and unbound for keys that nothing binds", () => {
    expectResults([
      { ide: "vscode", keys: [], result: { kind: "group", label: "" } },
      { ide: "intellij", keys: [], result: { kind: "group", label: "" } },
      { ide: "vscode", keys: ["x"], result: { kind: "unbound" } },
      { ide: "intellij", keys: ["SPC", "x"], result: { kind: "unbound" } },
    ]);
  });

  test("returns the entry of a leader key, supported unless its support level in the IDE is none", () => {
    const leaf = (entry: string, supported: boolean): Resolution => ({
      kind: "leaf",
      entry,
      supported,
    });
    expectResults([
      {
        ide: "vscode",
        keys: ["w", "h"],
        result: leaf("window.focus-left", true),
      },
      {
        ide: "intellij",
        keys: ["w", "h"],
        result: leaf("window.focus-left", true),
      },
      { ide: "vscode", keys: ["f", "f"], result: leaf("file.find", true) },
      { ide: "intellij", keys: ["SPC"], result: leaf("file.find", true) },
      { ide: "vscode", keys: ["/"], result: leaf("search.project", true) },
      { ide: "intellij", keys: ["c", "q"], result: leaf("code.action", true) },
      { ide: "vscode", keys: ["f", "r"], result: leaf("file.recent", true) },
      {
        ide: "vscode",
        keys: ["w", "m", "h"],
        result: leaf("window.move-left", true),
      },
      {
        ide: "intellij",
        keys: ["w", "m", "h"],
        result: leaf("window.move-left", false),
      },
      { ide: "vscode", keys: ["w", "h", "j"], result: { kind: "unbound" } },
    ]);
  });
});
