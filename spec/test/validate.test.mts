import { describe, expect, test } from "vitest";
import type { Diagnostic } from "../tools/core/catalog.mts";
import { validateCatalog } from "../tools/core/validate.mts";
import {
  entryOf,
  fileOf,
  loadSchemas,
  miniCatalogFiles,
  newEntry,
  type MiniCatalogFiles,
} from "./support/mini-catalog.mts";

const schemas = loadSchemas();

const CODE = "spec/catalog/commands/code.json";
const FILE = "spec/catalog/commands/file.json";
const SEARCH = "spec/catalog/commands/search.json";
const WINDOW = "spec/catalog/commands/window.json";
const GROUPS = "spec/catalog/groups.json";
const CTRL_KEYS = "spec/catalog/ctrl-keys.json";
const RETIRED_IDS = "spec/catalog/retired-ids.json";

const ID_PATTERN = "^[a-z][a-z0-9]*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)+$";
const LABEL_PATTERN = "^[A-Z][A-Za-z0-9 ,.'()/+-]*$";

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
  change: (files: MiniCatalogFiles) => void;
  expected: Diagnostic[];
};

/** Runs each case on a fresh mini catalog; one comparison shows every case that differs. */
function runCases(cases: Case[]) {
  const actual = cases.map(({ name, change }) => {
    const files = miniCatalogFiles();
    change(files);
    const { catalog, diagnostics } = validateCatalog(files, schemas);
    return { name, catalog: catalog !== undefined, diagnostics };
  });
  expect(actual).toEqual(
    cases.map(({ name, expected }) => ({
      name,
      catalog: expected.length === 0,
      diagnostics: expected,
    })),
  );
}

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

  test("SCHEMA reports the path and the problem where a file breaks its schema", () => {
    const schema = (file: string, where: string, message: string) => ({
      file,
      where,
      code: "SCHEMA",
      message,
    });
    runCases([
      {
        name: "an entry with only the parts it needs, and a file without $schema",
        change: (files) => {
          files.commands[3]!.data.commands.push({
            id: "git.blame",
            category: "git",
            keys: { leader: ["SPC g b"] },
            label: "Show line blame",
            description: "Shows who changed each line.",
            examples: ["SPC g b → names beside each line"],
            rationale: "Doom Emacs uses SPC g b.",
            stage: "stable",
            vscode: {
              exec: { command: "git.blame.toggleEditorDecoration" },
              exit: "editor",
              repeatable: false,
              count: "none",
            },
            support: { intellij: { level: "none", note: "Not in v0." } },
            verifiedAgainst: {
              vscode: "1.141.0",
              vscodevim: "1.32.4",
              intellij: "2026.2.3",
              ideavim: "2.47.3",
            },
          });
          delete loose(files.groups.data).$schema;
        },
        expected: [],
      },
      {
        name: "a command file without commands",
        change: (files) => {
          loose(files.commands[0]!).data = {
            $schema: "../../schema/commands.schema.json",
          };
        },
        expected: [schema(CODE, "/", "must have required property 'commands'")],
      },
      {
        name: "an entry without a label",
        change: (files) => {
          delete loose(entryOf(files, "code.action")).label;
        },
        expected: [
          schema(CODE, "/commands/0", "must have required property 'label'"),
        ],
      },
      {
        name: "an entry property that the shape does not have",
        change: (files) => {
          loose(entryOf(files, "code.action")).lable = "Show code actions";
        },
        expected: [
          schema(
            CODE,
            "/commands/0",
            'must NOT have additional properties: "lable"',
          ),
        ],
      },
      {
        name: "an id that is not dotted lowercase words",
        change: (files) => {
          entryOf(files, "code.action").id = "Code.action";
        },
        expected: [
          schema(CODE, "/commands/0/id", `must match pattern "${ID_PATTERN}"`),
        ],
      },
      {
        name: "a label longer than 24 characters",
        change: (files) => {
          entryOf(files, "code.action").label =
            "Show the available code actions";
        },
        expected: [
          schema(
            CODE,
            "/commands/0/label",
            "must NOT have more than 24 characters",
          ),
        ],
      },
      {
        name: "a label that starts in lowercase",
        change: (files) => {
          entryOf(files, "code.action").label = "show code actions";
        },
        expected: [
          schema(
            CODE,
            "/commands/0/label",
            `must match pattern "${LABEL_PATTERN}"`,
          ),
        ],
      },
      {
        name: "an empty key set",
        change: (files) => {
          entryOf(files, "code.action").keys = {};
        },
        expected: [
          schema(
            CODE,
            "/commands/0/keys",
            "must NOT have fewer than 1 properties",
          ),
        ],
      },
      {
        name: "an empty key list and a key listed twice",
        change: (files) => {
          entryOf(files, "code.action").keys = {
            leader: [],
            vim: ["gra", "gra"],
          };
        },
        expected: [
          schema(
            CODE,
            "/commands/0/keys/leader",
            "must NOT have fewer than 1 items",
          ),
          schema(
            CODE,
            "/commands/0/keys/vim",
            "must NOT have duplicate items (items ## 1 and 0 are identical)",
          ),
        ],
      },
      {
        name: "an unknown mode, a mode listed twice and no modes",
        change: (files) => {
          entryOf(files, "code.action").modes = ["n", "o" as "n"];
          entryOf(files, "code.hover").modes = ["x", "x"];
          entryOf(files, "search.project").modes = [];
        },
        expected: [
          schema(
            CODE,
            "/commands/0/modes/1",
            'must be equal to one of the allowed values: "n", "x"',
          ),
          schema(
            CODE,
            "/commands/1/modes",
            "must NOT have duplicate items (items ## 1 and 0 are identical)",
          ),
          schema(
            SEARCH,
            "/commands/0/modes",
            "must NOT have fewer than 1 items",
          ),
        ],
      },
      {
        name: "empty text and no examples",
        change: (files) => {
          entryOf(files, "code.action").description = "";
          entryOf(files, "code.action").examples = [""];
          entryOf(files, "code.hover").examples = [];
        },
        expected: [
          schema(
            CODE,
            "/commands/0/description",
            "must NOT have fewer than 1 characters",
          ),
          schema(
            CODE,
            "/commands/0/examples/0",
            "must NOT have fewer than 1 characters",
          ),
          schema(
            CODE,
            "/commands/1/examples",
            "must NOT have fewer than 1 items",
          ),
        ],
      },
      {
        name: "a stage other than stable and experimental",
        change: (files) => {
          loose(entryOf(files, "code.action")).stage = "beta";
        },
        expected: [
          schema(
            CODE,
            "/commands/0/stage",
            'must be equal to one of the allowed values: "stable", "experimental"',
          ),
        ],
      },
      {
        name: "an alias without until",
        change: (files) => {
          delete loose(entryOf(files, "search.project").aliases![0]!).until;
        },
        expected: [
          schema(
            SEARCH,
            "/commands/0/aliases/0",
            "must have required property 'until'",
          ),
        ],
      },
      {
        name: "a VS Code exec with both a command and Vim keys",
        change: (files) => {
          entryOf(files, "code.action").vscode!.exec = {
            command: "editor.action.quickFix",
            vimKeys: "gra",
          } as never;
        },
        expected: [
          schema(
            CODE,
            "/commands/0/vscode/exec",
            'must NOT have additional properties: "command"',
          ),
          schema(
            CODE,
            "/commands/0/vscode/exec",
            'must NOT have additional properties: "vimKeys"',
          ),
          schema(
            CODE,
            "/commands/0/vscode/exec",
            "must match exactly one schema in oneOf",
          ),
        ],
      },
      {
        name: "a command id with a space",
        change: (files) => {
          entryOf(files, "code.action").vscode!.exec = {
            command: "editor action",
          };
        },
        expected: [
          schema(
            CODE,
            "/commands/0/vscode/exec",
            'must NOT have additional properties: "command"',
          ),
          schema(
            CODE,
            "/commands/0/vscode/exec",
            "must have required property 'vimKeys'",
          ),
          schema(
            CODE,
            "/commands/0/vscode/exec",
            "must match exactly one schema in oneOf",
          ),
          schema(
            CODE,
            "/commands/0/vscode/exec/command",
            'must match pattern "^[A-Za-z0-9_.$-]+$"',
          ),
        ],
      },
      {
        name: "a VS Code flag that is not a boolean",
        change: (files) => {
          loose(entryOf(files, "code.action").vscode!).repeatable = "no";
        },
        expected: [
          schema(CODE, "/commands/0/vscode/repeatable", "must be boolean"),
        ],
      },
      {
        name: "an IntelliJ block with both an action and IdeaVim keys",
        change: (files) => {
          entryOf(files, "code.action").intellij = {
            action: "ShowIntentionActions",
            ideavimKeys: "gra",
          } as never;
        },
        expected: [
          schema(
            CODE,
            "/commands/0/intellij",
            'must NOT have additional properties: "action"',
          ),
          schema(
            CODE,
            "/commands/0/intellij",
            'must NOT have additional properties: "ideavimKeys"',
          ),
          schema(
            CODE,
            "/commands/0/intellij",
            "must match exactly one schema in oneOf",
          ),
        ],
      },
      {
        name: "semantics without a property",
        change: (files) => {
          entryOf(files, "code.hover").semantics = {};
        },
        expected: [
          schema(
            CODE,
            "/commands/1/semantics",
            "must NOT have fewer than 1 properties",
          ),
        ],
      },
      {
        name: "a deviation without a note",
        change: (files) => {
          delete loose(entryOf(files, "code.action").deviation!).note;
        },
        expected: [
          schema(
            CODE,
            "/commands/0/deviation",
            "must have required property 'note'",
          ),
        ],
      },
      {
        name: "a support level other than full, partial and none",
        change: (files) => {
          loose(entryOf(files, "file.recent").support!.vscode!).level = "some";
        },
        expected: [
          schema(
            FILE,
            "/commands/1/support/vscode/level",
            'must be equal to one of the allowed values: "full", "partial", "none"',
          ),
        ],
      },
      {
        name: "verifiedAgainst without the IdeaVim version",
        change: (files) => {
          delete loose(entryOf(files, "code.action").verifiedAgainst).ideavim;
        },
        expected: [
          schema(
            CODE,
            "/commands/0/verifiedAgainst",
            "must have required property 'ideavim'",
          ),
        ],
      },
      {
        name: "a group property that the shape does not have, and a lowercase group label",
        change: (files) => {
          loose(files.groups.data.groups[0]!).name = "Code";
          files.groups.data.groups[1]!.label = "file";
        },
        expected: [
          schema(
            GROUPS,
            "/groups/0",
            'must NOT have additional properties: "name"',
          ),
          schema(
            GROUPS,
            "/groups/1/label",
            `must match pattern "${LABEL_PATTERN}"`,
          ),
        ],
      },
      {
        name: "a Ctrl key without a handler",
        change: (files) => {
          delete loose(files.ctrlKeys.data.keys[0]!).handler;
        },
        expected: [
          schema(CTRL_KEYS, "/keys/0", "must have required property 'handler'"),
        ],
      },
      {
        name: "a retired id listed twice, and one that is not an id",
        change: (files) => {
          files.retiredIds.data.ids = ["file.old", "file.old", "Old"];
        },
        expected: [
          schema(
            RETIRED_IDS,
            "/ids",
            "must NOT have duplicate items (items ## 0 and 1 are identical)",
          ),
          schema(RETIRED_IDS, "/ids/2", `must match pattern "${ID_PATTERN}"`),
        ],
      },
    ]);
  });

  test("CATEGORY_MISMATCH reports a category that is not the file stem or the first part of the id", () => {
    runCases([
      {
        name: "an id with more than two parts",
        change: (files) => {
          fileOf(files, "code").data.commands.push(
            newEntry("code.refactor.extract", "SPC c e", "Extract to function"),
          );
        },
        expected: [],
      },
      {
        name: "a category that is not the file stem",
        change: (files) => {
          const entry = entryOf(files, "code.comment");
          entry.id = "window.comment";
          entry.category = "window";
        },
        expected: [
          diagnostic(
            CODE,
            "window.comment",
            "CATEGORY_MISMATCH",
            'category "window" differs from the file stem "code"',
          ),
        ],
      },
      {
        name: "an id that does not start with the category",
        change: (files) => {
          entryOf(files, "code.hover").id = "file.hover";
        },
        expected: [
          diagnostic(
            CODE,
            "file.hover",
            "CATEGORY_MISMATCH",
            'the id must start with the category: "code."',
          ),
        ],
      },
    ]);
  });

  test("DUPLICATE_ID reports an id that an earlier entry already uses", () => {
    runCases([
      {
        name: "the same name in another category",
        change: (files) => {
          fileOf(files, "window").data.commands.push(
            newEntry("window.next", "SPC w n", "Focus next split"),
          );
        },
        expected: [],
      },
      {
        name: "an id used twice in one file",
        change: (files) => {
          fileOf(files, "code").data.commands.push(
            newEntry("code.hover", "SPC c k", "Show signature"),
          );
        },
        expected: [
          diagnostic(
            CODE,
            "code.hover",
            "DUPLICATE_ID",
            `the id is already used in ${CODE}`,
          ),
        ],
      },
      {
        name: "an id used in two files",
        change: (files) => {
          const entry = newEntry("code.hover", "SPC w k", "Show hover");
          entry.category = "window";
          fileOf(files, "window").data.commands.push(entry);
        },
        expected: [
          diagnostic(
            WINDOW,
            "code.hover",
            "DUPLICATE_ID",
            `the id is already used in ${CODE}`,
          ),
          diagnostic(
            WINDOW,
            "code.hover",
            "CATEGORY_MISMATCH",
            'the id must start with the category: "window."',
          ),
        ],
      },
    ]);
  });
});
