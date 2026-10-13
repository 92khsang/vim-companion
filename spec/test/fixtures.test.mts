import { describe, expect, test } from "vitest";
import { fixtureIndex } from "../tools/core/fixtures.mts";

/** A fixture file with cases of these ids and nothing else. */
const casesFile = (path: string, ...ids: string[]) => ({
  path,
  data: { cases: ids.map((id) => ({ id })) },
});

describe("fixtureIndex", () => {
  test("lists the case ids of each set as <file stem>/<id> in code-unit order", () => {
    const text = fixtureIndex({
      catalog: [
        casesFile(
          "spec/fixtures/catalog/leader.json",
          "unbound-x",
          "group-w",
          "leaf-w-h",
        ),
        casesFile("spec/fixtures/catalog/leader-2.json", "root"),
        casesFile("spec/fixtures/catalog/aliases.json", "expired"),
      ],
      hintView: [
        casesFile(
          "spec/fixtures/hint-view/root.json",
          "root-vscode",
          "root-intellij",
        ),
      ],
      versionOrder: {
        path: "spec/fixtures/version-order.json",
        data: { ascending: ["1.0.0", "2.0.0"] },
      },
    });
    expect(text).toBe(
      [
        "{",
        '  "catalog": [',
        '    "aliases/expired",',
        '    "leader-2/root",',
        '    "leader/group-w",',
        '    "leader/leaf-w-h",',
        '    "leader/unbound-x"',
        "  ],",
        '  "hint-view": [',
        '    "root/root-intellij",',
        '    "root/root-vscode"',
        "  ],",
        '  "version-order": [',
        '    "ascending"',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});
