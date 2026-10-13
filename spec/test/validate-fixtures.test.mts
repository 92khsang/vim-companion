import { describe, expect, test } from "vitest";
import type { Diagnostic } from "../tools/core/catalog.mts";
import { validateFixtures } from "../tools/core/validate.mts";
import { loadSchemas } from "./support/mini-catalog.mts";
import {
  miniFixtureFiles,
  type MiniFixtureFiles,
} from "./support/mini-fixtures.mts";

const schemas = loadSchemas();

const CATALOG = "spec/fixtures/catalog/leader.json";
const HINT_VIEW = "spec/fixtures/hint-view/window.json";
const VERSION_ORDER = "spec/fixtures/version-order.json";

// The patterns of fixture-catalog.schema.json.
const CASE_ID_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const KEY_PATTERN = "^(?:SPC|[a-zA-Z0-9/?:=])$";
const VERSION_PATTERN =
  "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?$";

const diagnostic = (
  file: string,
  where: string,
  code: string,
  message: string,
): Diagnostic => ({ file, where, code, message });

/** A view of a typed object that lets a test break its shape. */
const loose = (value: object) => value as Record<string, unknown>;

type Case = {
  name: string;
  change: (files: MiniFixtureFiles) => void;
  expected: Diagnostic[];
};

/** Runs each case on fresh mini fixtures; one comparison shows every case that differs. */
function runCases(cases: Case[]) {
  const actual = cases.map(({ name, change }) => {
    const files = miniFixtureFiles();
    change(files);
    return { name, diagnostics: validateFixtures(files, schemas) };
  });
  expect(actual).toEqual(
    cases.map(({ name, expected }) => ({ name, diagnostics: expected })),
  );
}

describe("validateFixtures", () => {
  test("SCHEMA reports the path and the problem where a fixture file breaks its schema", () => {
    const schema = (file: string, where: string, message: string) =>
      diagnostic(file, where, "SCHEMA", message);
    runCases([
      { name: "valid fixtures", change: () => {}, expected: [] },
      {
        name: "a catalog fixture without a description, with an unknown property",
        change: (files) => {
          const data = loose(files.catalog[0]!.data);
          delete data.description;
          data.note = "x";
        },
        expected: [
          schema(CATALOG, "/", 'must NOT have additional properties: "note"'),
          schema(CATALOG, "/", "must have required property 'description'"),
        ],
      },
      {
        name: "no cases",
        change: (files) => {
          files.catalog[0]!.data.cases = [];
        },
        expected: [
          schema(CATALOG, "/cases", "must NOT have fewer than 1 items"),
        ],
      },
      {
        name: "a case id that is not kebab-case, an unknown IDE, a key with a space",
        change: (files) => {
          const [first, second] = files.catalog[0]!.data.cases;
          first!.id = "Leaf_W";
          loose(second!).ide = "vim";
          second!.keys = ["w h"];
        },
        expected: [
          schema(
            CATALOG,
            "/cases/0/id",
            `must match pattern "${CASE_ID_PATTERN}"`,
          ),
          schema(
            CATALOG,
            "/cases/1/ide",
            'must be equal to one of the allowed values: "vscode", "intellij"',
          ),
          schema(
            CATALOG,
            "/cases/1/keys/0",
            `must match pattern "${KEY_PATTERN}"`,
          ),
        ],
      },
      {
        name: "options with a version that is not SemVer and a string for a boolean",
        change: (files) => {
          loose(files.catalog[0]!.data.cases[1]!).options = {
            experimental: "yes",
            version: "1.0",
          };
        },
        expected: [
          schema(CATALOG, "/cases/1/options/experimental", "must be boolean"),
          schema(
            CATALOG,
            "/cases/1/options/version",
            `must match pattern "${VERSION_PATTERN}"`,
          ),
        ],
      },
      {
        name: "an expected group without its label, which matches no shape of expect",
        change: (files) => {
          loose(files.catalog[0]!.data.cases[0]!).expect = { kind: "group" };
        },
        expected: [
          schema(
            CATALOG,
            "/cases/0/expect",
            "must have required property 'entry'",
          ),
          schema(
            CATALOG,
            "/cases/0/expect",
            "must have required property 'label'",
          ),
          schema(
            CATALOG,
            "/cases/0/expect",
            "must have required property 'supported'",
          ),
          schema(
            CATALOG,
            "/cases/0/expect",
            "must match exactly one schema in oneOf",
          ),
          schema(CATALOG, "/cases/0/expect/kind", "must be equal to constant"),
          schema(CATALOG, "/cases/0/expect/kind", "must be equal to constant"),
        ],
      },
      {
        name: "an inline catalog without groups, with an entry that breaks the entry schema",
        change: (files) => {
          const catalog = loose(files.catalog[0]!.data.catalog);
          delete catalog.groups;
          loose(files.catalog[0]!.data.catalog.entries[0]!).lable = "Show";
        },
        expected: [
          schema(CATALOG, "/catalog", "must have required property 'groups'"),
          schema(
            CATALOG,
            "/catalog/entries/0",
            'must NOT have additional properties: "lable"',
          ),
        ],
      },
      {
        name: "hint view rows with a + label and an unknown badge, a case without a prefix",
        change: (files) => {
          const [hintCase] = files.hintView[0]!.data.cases;
          hintCase!.rows[2]!.label = "+Move";
          loose(hintCase!.rows[1]!).badge = "bogus";
          delete loose(hintCase!).prefix;
        },
        expected: [
          schema(HINT_VIEW, "/cases/0", "must have required property 'prefix'"),
          schema(
            HINT_VIEW,
            "/cases/0/rows/1/badge",
            'must be equal to one of the allowed values: "unsupported", "experimental", "fallback", "differs-from-vim", null',
          ),
          schema(
            HINT_VIEW,
            "/cases/0/rows/2/label",
            'must match pattern "^[^+]"',
          ),
        ],
      },
      {
        name: "a version order with one version, which is not SemVer",
        change: (files) => {
          files.versionOrder.data.ascending = ["1.0"];
        },
        expected: [
          schema(
            VERSION_ORDER,
            "/ascending",
            "must NOT have fewer than 2 items",
          ),
          schema(
            VERSION_ORDER,
            "/ascending/0",
            `must match pattern "${VERSION_PATTERN}"`,
          ),
        ],
      },
    ]);
  });

  test("checks the inline catalog of each fixture file with the catalog rules, without the file stem as its category", () => {
    const catalogEntry = (files: MiniFixtureFiles, id: string) =>
      files.catalog[0]!.data.catalog.entries.find((entry) => entry.id === id)!;
    runCases([
      {
        name: "entries of many categories in one fixture file",
        change: () => {},
        expected: [],
      },
      {
        name: "an id that does not start with the category",
        change: (files) => {
          catalogEntry(files, "file.find").category = "files";
        },
        expected: [
          diagnostic(
            CATALOG,
            "file.find",
            "CATEGORY_MISMATCH",
            'the id must start with the category: "files."',
          ),
        ],
      },
      {
        name: "a missing group label",
        change: (files) => {
          const { catalog } = files.catalog[0]!.data;
          catalog.groups = catalog.groups.filter(
            (group) => group.keys !== "SPC w m",
          );
        },
        expected: [
          diagnostic(
            CATALOG,
            "SPC w m",
            "MISSING_GROUP",
            'no group label for this prefix of "SPC w m h", bound by window.move-left',
          ),
        ],
      },
      {
        name: "an id used twice",
        change: (files) => {
          const { entries } = files.hintView[0]!.data.catalog;
          const only = entries.find((entry) => entry.id === "window.only")!;
          entries.push({
            ...only,
            keys: { leader: ["SPC w O"] },
            label: "Close all other splits",
          });
        },
        expected: [
          diagnostic(
            HINT_VIEW,
            "window.only",
            "DUPLICATE_ID",
            "the id is already used in spec/fixtures/hint-view/window.json",
          ),
        ],
      },
      {
        name: "no rules for a file that breaks its schema, and the rules for the others",
        change: (files) => {
          loose(files.catalog[0]!.data).note = "x";
          for (const file of [files.catalog[0]!, files.hintView[0]!]) {
            file.data.catalog.groups.push({ keys: "SPC t", label: "Tab" });
          }
        },
        expected: [
          diagnostic(
            CATALOG,
            "/",
            "SCHEMA",
            'must NOT have additional properties: "note"',
          ),
          diagnostic(
            HINT_VIEW,
            "SPC t",
            "UNUSED_GROUP",
            "no leader key is below this prefix",
          ),
        ],
      },
    ]);
  });
});
