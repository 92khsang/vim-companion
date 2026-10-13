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
const DIAG = "spec/catalog/commands/diag.json";
const FILE = "spec/catalog/commands/file.json";
const SEARCH = "spec/catalog/commands/search.json";
const WINDOW = "spec/catalog/commands/window.json";
const GROUPS = "spec/catalog/groups.json";
const CTRL_KEYS = "spec/catalog/ctrl-keys.json";
const RETIRED_IDS = "spec/catalog/retired-ids.json";

const ID_PATTERN = "^[a-z][a-z0-9]*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)+$";
const LABEL_PATTERN = "^[A-Z][A-Za-z0-9 ,.'()/+-]*$";
// The notation messages of keys.mts after the quoted key.
const NOT_LEADER =
  'is not a leader key: "SPC" and then keys separated by single spaces, each SPC or one of a-z A-Z 0-9 / ? : =';
const NOT_VIM =
  "is not a Vim key: keys without spaces, each a printable ASCII character other than < and |, or a <...> group such as <C-w>";

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

  test("KEY_SYNTAX reports leader and Vim keys that break the key notation", () => {
    runCases([
      {
        name: "IdeaVim keys that write | as <Bar>",
        change: (files) => {
          entryOf(files, "window.focus-left").intellij = {
            ideavimKeys: "<C-w><Bar>",
          };
        },
        expected: [],
      },
      {
        name: "a leader key with two spaces",
        change: (files) => {
          entryOf(files, "file.find").keys.leader = ["SPC f f", "SPC  SPC"];
        },
        expected: [
          diagnostic(
            FILE,
            "file.find",
            "KEY_SYNTAX",
            `keys.leader[1]: "SPC  SPC" ${NOT_LEADER}`,
          ),
        ],
      },
      {
        name: "a Vim key with a space",
        change: (files) => {
          entryOf(files, "diag.next").keys.vim = ["] d"];
        },
        expected: [
          diagnostic(
            DIAG,
            "diag.next",
            "KEY_SYNTAX",
            `keys.vim[0]: "] d" ${NOT_VIM}`,
          ),
        ],
      },
      {
        name: "an alias key with a trailing space",
        change: (files) => {
          entryOf(files, "search.project").aliases![0]!.keys.leader = [
            "SPC f s ",
          ];
        },
        expected: [
          diagnostic(
            SEARCH,
            "search.project",
            "KEY_SYNTAX",
            `aliases[0].keys.leader[0]: "SPC f s " ${NOT_LEADER}`,
          ),
        ],
      },
      {
        name: "VSCodeVim keys with a < that opens no group",
        change: (files) => {
          entryOf(files, "window.only").vscode!.exec = { vimKeys: "<C-w>o<" };
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.only",
            "KEY_SYNTAX",
            `vscode.exec.vimKeys: "<C-w>o<" ${NOT_VIM}`,
          ),
        ],
      },
      {
        name: "IdeaVim keys with a |, which ends a map command",
        change: (files) => {
          entryOf(files, "window.focus-left").intellij = {
            ideavimKeys: "<C-w>|",
          };
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.focus-left",
            "KEY_SYNTAX",
            `intellij.ideavimKeys: "<C-w>|" ${NOT_VIM}; write | as <Bar>`,
          ),
        ],
      },
      {
        name: "IdeaVim keys with a space",
        change: (files) => {
          entryOf(files, "code.comment").intellij = {
            ideavimKeys: "gc c",
            provider: "commentary",
          };
        },
        expected: [
          diagnostic(
            CODE,
            "code.comment",
            "KEY_SYNTAX",
            `intellij.ideavimKeys: "gc c" ${NOT_VIM}`,
          ),
        ],
      },
      {
        name: "a group key without the space between its keys",
        change: (files) => {
          files.groups.data.groups.push({ keys: "SPC ga", label: "Goto" });
        },
        expected: [
          diagnostic(GROUPS, "SPC ga", "KEY_SYNTAX", `"SPC ga" ${NOT_LEADER}`),
        ],
      },
    ]);
  });

  test("FORBIDDEN_KEY reports Vim keys with Alt, modifier+Space or bare function keys, or that redefine a protected key", () => {
    const PROTECTED =
      "one of the keys the catalog never redefines: ]b [b ]w [w ]p [p gh gi";
    runCases([
      {
        name: "a modified function key, a capital ]B and g]",
        change: (files) => {
          entryOf(files, "diag.next").keys.vim = ["]d", "<S-F8>", "]B", "g]"];
        },
        expected: [],
      },
      {
        name: "an Alt chord",
        change: (files) => {
          entryOf(files, "code.hover").keys.vim = ["K", "<A-k>"];
        },
        expected: [
          diagnostic(
            CODE,
            "code.hover",
            "FORBIDDEN_KEY",
            'keys.vim[1] "<A-k>" has the Alt chord <A-k>',
          ),
        ],
      },
      {
        name: "a Meta chord written in lowercase",
        change: (files) => {
          entryOf(files, "code.action").keys.vim = ["gra", "<c-m-a>"];
        },
        expected: [
          diagnostic(
            CODE,
            "code.action",
            "FORBIDDEN_KEY",
            'keys.vim[1] "<c-m-a>" has the Alt chord <c-m-a>',
          ),
        ],
      },
      {
        name: "an alias with Ctrl+Space",
        change: (files) => {
          entryOf(files, "diag.next").aliases![0]!.keys.vim = ["<C-Space>"];
        },
        expected: [
          diagnostic(
            DIAG,
            "diag.next",
            "FORBIDDEN_KEY",
            'aliases[0].keys.vim[0] "<C-Space>" has the modifier+Space chord <C-Space>',
          ),
        ],
      },
      {
        name: "bare function keys",
        change: (files) => {
          entryOf(files, "code.hover").keys.vim = ["<F1>", "<f12>"];
        },
        expected: [
          diagnostic(
            CODE,
            "code.hover",
            "FORBIDDEN_KEY",
            'keys.vim[0] "<F1>" has the bare function key <F1>',
          ),
          diagnostic(
            CODE,
            "code.hover",
            "FORBIDDEN_KEY",
            'keys.vim[1] "<f12>" has the bare function key <f12>',
          ),
        ],
      },
      {
        name: "keys that are or start with a protected key",
        change: (files) => {
          entryOf(files, "code.action").keys.vim = ["]b", "gih"];
        },
        expected: [
          diagnostic(
            CODE,
            "code.action",
            "FORBIDDEN_KEY",
            `keys.vim[0] "]b" starts with "]b", ${PROTECTED}`,
          ),
          diagnostic(
            CODE,
            "code.action",
            "FORBIDDEN_KEY",
            `keys.vim[1] "gih" starts with "gi", ${PROTECTED}`,
          ),
        ],
      },
    ]);
  });

  test("RESERVED_KEY reports a leader key with ?", () => {
    const RESERVED =
      "contains the reserved key ?: SPC ? is the catalog search, and ? below the root shows the hints";
    runCases([
      {
        name: "a leader key with = and one with /",
        change: (files) => {
          fileOf(files, "file").data.commands.push(
            newEntry("file.format", "SPC f =", "Format file"),
          );
        },
        expected: [],
      },
      {
        name: "? at the root",
        change: (files) => {
          fileOf(files, "search").data.commands.push(
            newEntry("search.catalog", "SPC ?", "Search the catalog"),
          );
        },
        expected: [
          diagnostic(
            SEARCH,
            "search.catalog",
            "RESERVED_KEY",
            `keys.leader[0] "SPC ?" ${RESERVED}`,
          ),
        ],
      },
      {
        name: "? below the root, in an alias",
        change: (files) => {
          entryOf(files, "search.project").aliases![0]!.keys.leader = [
            "SPC f ?",
          ];
        },
        expected: [
          diagnostic(
            SEARCH,
            "search.project",
            "RESERVED_KEY",
            `aliases[0].keys.leader[0] "SPC f ?" ${RESERVED}`,
          ),
        ],
      },
    ]);
  });

  test("DUPLICATE_KEY reports a key that an earlier key of the same kind binds in a shared mode", () => {
    const deviation = {
      shadows: "Vim K",
      origin: "Vim",
      note: "Runs an IDE action instead.",
    };
    runCases([
      {
        name: "the same Vim key in modes that do not overlap",
        change: (files) => {
          const entry = newEntry("code.hover-visual", "SPC c v", "Show docs");
          entry.keys = { vim: ["K"] };
          entry.modes = ["x"];
          entry.deviation = deviation;
          fileOf(files, "code").data.commands.push(entry);
        },
        expected: [],
      },
      {
        name: "a leader key that another entry binds",
        change: (files) => {
          fileOf(files, "file").data.commands.push(
            newEntry("file.open", "SPC f f", "Open file"),
          );
        },
        expected: [
          diagnostic(
            FILE,
            "file.open",
            "DUPLICATE_KEY",
            'keys.leader[0] "SPC f f" is also bound by file.find',
          ),
        ],
      },
      {
        name: "a Vim key that an alias of another entry binds",
        change: (files) => {
          const entry = newEntry("diag.error", "SPC c x", "Go to next error");
          entry.keys = { vim: ["]e"] };
          entry.deviation = deviation;
          fileOf(files, "diag").data.commands.push(entry);
        },
        expected: [
          diagnostic(
            DIAG,
            "diag.error",
            "DUPLICATE_KEY",
            'keys.vim[0] "]e" is also bound by diag.next (alias)',
          ),
        ],
      },
      {
        name: "two aliases of one entry with the same key",
        change: (files) => {
          entryOf(files, "search.project").aliases!.push({
            keys: { leader: ["SPC f s"] },
            until: "2.0.0",
          });
        },
        expected: [
          diagnostic(
            SEARCH,
            "search.project",
            "DUPLICATE_KEY",
            'aliases[1].keys.leader[0] "SPC f s" is also bound by search.project (alias)',
          ),
        ],
      },
    ]);
  });

  test("PREFIX_CONFLICT reports a key that starts a longer key of its kind, whatever the modes", () => {
    const deviation = {
      shadows: "Vim ]",
      origin: "Vim",
      note: "Runs an IDE action instead.",
    };
    runCases([
      {
        name: "Vim keys that share their first keys",
        change: (files) => {
          const entry = newEntry("code.rename", "SPC c r", "Rename symbol");
          entry.keys = { vim: ["grn"] };
          entry.deviation = deviation;
          fileOf(files, "code").data.commands.push(entry);
        },
        expected: [],
      },
      {
        name: "a leader key where a group must be",
        change: (files) => {
          fileOf(files, "window").data.commands.push(
            newEntry("window.menu", "SPC w", "Show window menu"),
          );
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.menu",
            "PREFIX_CONFLICT",
            'keys.leader[0] "SPC w" is a prefix of "SPC w h", bound by window.focus-left',
          ),
          diagnostic(
            WINDOW,
            "window.menu",
            "PREFIX_CONFLICT",
            'keys.leader[0] "SPC w" is a prefix of "SPC w m h", bound by window.move-left',
          ),
          diagnostic(
            WINDOW,
            "window.menu",
            "PREFIX_CONFLICT",
            'keys.leader[0] "SPC w" is a prefix of "SPC w o", bound by window.only',
          ),
        ],
      },
      {
        name: "a Visual-mode Vim key that starts Normal-mode keys",
        change: (files) => {
          const entry = newEntry("diag.menu", "SPC c m", "Show problem menu");
          entry.keys = { vim: ["]"] };
          entry.modes = ["x"];
          entry.deviation = deviation;
          fileOf(files, "diag").data.commands.push(entry);
        },
        expected: [
          diagnostic(
            DIAG,
            "diag.menu",
            "PREFIX_CONFLICT",
            'keys.vim[0] "]" is a prefix of "]d", bound by diag.next',
          ),
          diagnostic(
            DIAG,
            "diag.menu",
            "PREFIX_CONFLICT",
            'keys.vim[0] "]" is a prefix of "]e", bound by diag.next (alias)',
          ),
        ],
      },
      {
        name: "an alias that starts the key of its own entry",
        change: (files) => {
          entryOf(files, "diag.next").aliases![0]!.keys.vim = ["]"];
        },
        expected: [
          diagnostic(
            DIAG,
            "diag.next",
            "PREFIX_CONFLICT",
            'aliases[0].keys.vim[0] "]" is a prefix of "]d", bound by diag.next',
          ),
        ],
      },
    ]);
  });

  test("MISSING_GROUP reports, once, a leader prefix below the root that has no group label", () => {
    runCases([
      {
        name: "a leaf at the root",
        change: (files) => {
          fileOf(files, "git").data.commands.push(
            newEntry("git.blame", "SPC b", "Show line blame"),
          );
        },
        expected: [],
      },
      {
        name: "two keys below a prefix without a group",
        change: (files) => {
          fileOf(files, "git").data.commands.push(
            newEntry("git.log", "SPC x l", "Show Git log"),
            newEntry("git.push", "SPC x p", "Push commits"),
          );
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC x",
            "MISSING_GROUP",
            'no group label for this prefix of "SPC x l", bound by git.log',
          ),
        ],
      },
      {
        name: "an alias two groups deep",
        change: (files) => {
          entryOf(files, "search.project").aliases![0]!.keys.leader = [
            "SPC f z s",
          ];
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC f z",
            "MISSING_GROUP",
            'no group label for this prefix of "SPC f z s", bound by search.project (alias)',
          ),
        ],
      },
    ]);
  });

  test("UNUSED_GROUP reports a group with no leader key below its prefix", () => {
    runCases([
      {
        name: "a group whose only key is an alias",
        change: (files) => {
          files.groups.data.groups.push({ keys: "SPC f z", label: "Zoom" });
          entryOf(files, "search.project").aliases![0]!.keys.leader = [
            "SPC f z s",
          ];
        },
        expected: [],
      },
      {
        name: "a group with no key below it",
        change: (files) => {
          files.groups.data.groups.push({ keys: "SPC t", label: "Toggle" });
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC t",
            "UNUSED_GROUP",
            "no leader key is below this prefix",
          ),
        ],
      },
      {
        name: "a group whose prefix is a leaf",
        change: (files) => {
          files.groups.data.groups.push({ keys: "SPC SPC", label: "Space" });
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC SPC",
            "UNUSED_GROUP",
            "no leader key is below this prefix",
          ),
        ],
      },
    ]);
  });

  test("DUPLICATE_GROUP reports a prefix that has a group already", () => {
    runCases([
      {
        name: "one label for groups of two prefixes",
        change: (files) => {
          files.groups.data.groups[4]!.label = "Code";
        },
        expected: [],
      },
      {
        name: "a prefix with a second, different label",
        change: (files) => {
          files.groups.data.groups.push({ keys: "SPC w", label: "Windows" });
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC w",
            "DUPLICATE_GROUP",
            'the prefix already has the group label "Window"',
          ),
        ],
      },
      {
        name: "a group listed twice",
        change: (files) => {
          files.groups.data.groups.push({ keys: "SPC c", label: "Code" });
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC c",
            "DUPLICATE_GROUP",
            'the prefix already has the group label "Code"',
          ),
        ],
      },
    ]);
  });

  test("DUPLICATE_LABEL reports a label that another child of the same leader prefix has", () => {
    runCases([
      {
        name: "a group label under another prefix, and alias labels",
        change: (files) => {
          fileOf(files, "window").data.commands.push(
            newEntry("window.new", "SPC w n", "Window"),
          );
          entryOf(files, "search.project").aliases!.push({
            keys: { leader: ["SPC f x"] },
            until: "1.0.0",
          });
        },
        expected: [],
      },
      {
        name: "two entries with one label below a prefix",
        change: (files) => {
          fileOf(files, "file").data.commands.push(
            newEntry("file.open", "SPC f o", "Find file"),
          );
        },
        expected: [
          diagnostic(
            FILE,
            "file.open",
            "DUPLICATE_LABEL",
            'keys.leader[0] "SPC f o": the label "Find file" is also used under "SPC f" by file.find "SPC f f"',
          ),
        ],
      },
      {
        name: "one entry twice below a prefix",
        change: (files) => {
          entryOf(files, "file.find").keys.leader!.push("SPC f g");
        },
        expected: [
          diagnostic(
            FILE,
            "file.find",
            "DUPLICATE_LABEL",
            'keys.leader[2] "SPC f g": the label "Find file" is also used under "SPC f" by file.find "SPC f f"',
          ),
        ],
      },
      {
        name: "a group with the label of a leaf at the root",
        change: (files) => {
          fileOf(files, "git").data.commands.push(
            newEntry("git.blame", "SPC b", "Git"),
          );
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC g",
            "DUPLICATE_LABEL",
            'the label "Git" is also used under "SPC" by git.blame "SPC b"',
          ),
        ],
      },
      {
        name: "two groups with one label below a prefix",
        change: (files) => {
          files.groups.data.groups[2]!.label = "Code";
        },
        expected: [
          diagnostic(
            GROUPS,
            "SPC g",
            "DUPLICATE_LABEL",
            'the label "Code" is also used under "SPC" by group "SPC c"',
          ),
        ],
      },
    ]);
  });
});
