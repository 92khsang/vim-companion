import { describe, expect, test } from "vitest";
import type {
  Diagnostic,
  Entry,
  IntellijBinding,
  VscodeExec,
} from "../tools/core/catalog.mts";
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

/** code.join: the Vim key gJ, which each IDE runs as given. */
function joinEntry(vscode: VscodeExec, intellij: IntellijBinding): Entry {
  const entry = newEntry("code.join", "SPC c j", "Join lines");
  entry.keys = { vim: ["gJ"], leader: ["SPC c j"] };
  entry.vscode = {
    exec: vscode,
    exit: "editor",
    repeatable: false,
    count: "none",
  };
  entry.intellij = intellij;
  return entry;
}

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

  test("FORBIDDEN_KEY reports Vim keys with Alt, modifier+Space, bare function keys or the leader, or that redefine a protected key", () => {
    const PROTECTED =
      "one of the keys the catalog never redefines: ]b [b ]w [w ]p [p gh gi";
    const LEADER = "leader keys go in keys.leader, starting with SPC";
    runCases([
      {
        name: "a Vim key with <Space> after its first key",
        change: (files) => {
          entryOf(files, "code.hover").keys.vim = ["K", "g<Space>"];
        },
        expected: [],
      },
      {
        name: "Vim keys with <leader> in any case, in an alias too",
        change: (files) => {
          entryOf(files, "code.hover").keys.vim = [
            "K",
            "<leader>d",
            "g<LEADER>",
          ];
          entryOf(files, "diag.next").aliases![0]!.keys.vim = ["<Leader>e"];
        },
        expected: [
          diagnostic(
            CODE,
            "code.hover",
            "FORBIDDEN_KEY",
            `keys.vim[1] "<leader>d" contains <leader>; ${LEADER}`,
          ),
          diagnostic(
            CODE,
            "code.hover",
            "FORBIDDEN_KEY",
            `keys.vim[2] "g<LEADER>" contains <LEADER>; ${LEADER}`,
          ),
          diagnostic(
            DIAG,
            "diag.next",
            "FORBIDDEN_KEY",
            `aliases[0].keys.vim[0] "<Leader>e" contains <Leader>; ${LEADER}`,
          ),
        ],
      },
      {
        name: "Vim keys that start with <Space> in any case, in an alias too",
        change: (files) => {
          entryOf(files, "code.action").keys.vim = ["gra", "<space>a"];
          entryOf(files, "diag.next").aliases![0]!.keys.vim = ["<SPACE>e"];
        },
        expected: [
          diagnostic(
            CODE,
            "code.action",
            "FORBIDDEN_KEY",
            `keys.vim[1] "<space>a" starts with <space>, the leader; ${LEADER}`,
          ),
          diagnostic(
            DIAG,
            "diag.next",
            "FORBIDDEN_KEY",
            `aliases[0].keys.vim[0] "<SPACE>e" starts with <SPACE>, the leader; ${LEADER}`,
          ),
        ],
      },
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
        name: "Meta and Alt chords of >, whose group ends at the first >",
        change: (files) => {
          entryOf(files, "code.hover").keys.vim = ["K", "<M->>", "<A->>"];
        },
        expected: [
          diagnostic(
            CODE,
            "code.hover",
            "FORBIDDEN_KEY",
            'keys.vim[1] "<M->>" has the Alt chord <M->',
          ),
          diagnostic(
            CODE,
            "code.hover",
            "FORBIDDEN_KEY",
            'keys.vim[2] "<A->>" has the Alt chord <A->',
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

  test("DUPLICATE_KEY reports a key that an earlier key of the same kind binds, whatever the modes", () => {
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
        expected: [
          diagnostic(
            CODE,
            "code.hover-visual",
            "DUPLICATE_KEY",
            'keys.vim[0] "K" is also bound by code.hover',
          ),
        ],
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
        name: "a leader key that another entry binds in Visual mode only",
        change: (files) => {
          const entry = newEntry("file.pick", "SPC f f", "Pick file");
          entry.modes = ["x"];
          fileOf(files, "file").data.commands.push(entry);
        },
        expected: [
          diagnostic(
            FILE,
            "file.pick",
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
        name: "a Visual-mode Vim key that an alias of a Normal-mode entry binds",
        change: (files) => {
          const entry = newEntry("diag.error", "SPC c x", "Go to next error");
          entry.keys = { vim: ["]e"] };
          entry.modes = ["x"];
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
      {
        name: "a Vim key that another entry binds, with other case inside <...>",
        change: (files) => {
          const exchange = newEntry("window.exchange", "SPC w x", "Swap");
          exchange.keys = { vim: ["<C-w>x"] };
          exchange.deviation = deviation;
          const swap = newEntry("window.swap", "SPC w X", "Swap");
          swap.keys = { vim: ["<c-W>x"] };
          swap.deviation = deviation;
          fileOf(files, "window").data.commands.push(exchange, swap);
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.swap",
            "DUPLICATE_KEY",
            'keys.vim[0] "<c-W>x" is also bound by window.exchange',
          ),
        ],
      },
      {
        name: "two keys of one entry that differ only in case inside <...>",
        change: (files) => {
          const entry = newEntry("window.exchange", "SPC w x", "Swap");
          entry.keys = { vim: ["<C-w>x", "<c-W>x"] };
          entry.deviation = deviation;
          fileOf(files, "window").data.commands.push(entry);
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.exchange",
            "DUPLICATE_KEY",
            'keys.vim[1] "<c-W>x" is also bound by window.exchange',
          ),
        ],
      },
      {
        name: "Vim keys that differ in case outside <...>",
        change: (files) => {
          const exchange = newEntry("window.exchange", "SPC w x", "Swap");
          exchange.keys = { vim: ["<C-w>x"] };
          exchange.deviation = deviation;
          const swap = newEntry("window.swap", "SPC w X", "Swap");
          swap.keys = { vim: ["<C-w>X"] };
          swap.deviation = deviation;
          fileOf(files, "window").data.commands.push(exchange, swap);
        },
        expected: [],
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
      {
        name: "a Vim key that starts a longer key, with other case inside <...>",
        change: (files) => {
          const menu = newEntry("window.menu", "SPC w n", "Show window menu");
          menu.keys = { vim: ["<C-w>"] };
          menu.deviation = deviation;
          const exchange = newEntry("window.exchange", "SPC w x", "Swap");
          exchange.keys = { vim: ["<c-W>x"] };
          exchange.deviation = deviation;
          fileOf(files, "window").data.commands.push(menu, exchange);
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.menu",
            "PREFIX_CONFLICT",
            'keys.vim[0] "<C-w>" is a prefix of "<c-W>x", bound by window.exchange',
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

  test("MISSING_DEVIATION reports an entry without a deviation whose Vim key an IDE remaps", () => {
    runCases([
      {
        name: "a Vim key that both engines run natively",
        change: (files) => {
          fileOf(files, "code").data.commands.push(
            joinEntry({ vimKeys: "gJ" }, { ideavimKeys: "gJ" }),
          );
        },
        expected: [],
      },
      {
        name: "a Vim key that both engines run natively, with other case inside <...>",
        change: (files) => {
          const entry = newEntry("window.rotate", "SPC w r", "Rotate splits");
          entry.keys = { vim: ["<C-w>r"] };
          entry.vscode = {
            exec: { vimKeys: "<c-w>r" },
            exit: "editor",
            repeatable: false,
            count: "none",
          };
          entry.intellij = { ideavimKeys: "<C-W>r" };
          fileOf(files, "window").data.commands.push(entry);
        },
        expected: [],
      },
      {
        name: "a Vim key native in the only IDE that supports the entry",
        change: (files) => {
          const entry = newEntry("diag.hunk", "SPC c h", "Go to next change");
          entry.keys = { vim: ["]c"] };
          delete entry.vscode;
          entry.intellij = { ideavimKeys: "]c" };
          entry.support = {
            vscode: { level: "none", note: "VS Code has no change motion." },
          };
          fileOf(files, "diag").data.commands.push(entry);
        },
        expected: [],
      },
      {
        name: "a Vim key that both IDEs run as a command",
        change: (files) => {
          delete entryOf(files, "code.action").deviation;
        },
        expected: [
          diagnostic(
            CODE,
            "code.action",
            "MISSING_DEVIATION",
            'keys.vim[0] "gra" is remapped in VS Code, so "deviation" is required',
          ),
        ],
      },
      {
        name: "a Vim key native in IntelliJ but a command in VS Code",
        change: (files) => {
          delete entryOf(files, "code.hover").deviation;
        },
        expected: [
          diagnostic(
            CODE,
            "code.hover",
            "MISSING_DEVIATION",
            'keys.vim[0] "K" is remapped in VS Code, so "deviation" is required',
          ),
        ],
      },
      {
        name: "an alias Vim key that the engines run as other keys",
        change: (files) => {
          const entry = joinEntry({ vimKeys: "gJ" }, { ideavimKeys: "gJ" });
          entry.aliases = [{ keys: { vim: ["gX"] }, until: "1.0.0" }];
          fileOf(files, "code").data.commands.push(entry);
        },
        expected: [
          diagnostic(
            CODE,
            "code.join",
            "MISSING_DEVIATION",
            'aliases[0].keys.vim[0] "gX" is remapped in VS Code, so "deviation" is required',
          ),
        ],
      },
      {
        name: "a Vim key that only IntelliJ runs as an action",
        change: (files) => {
          const entry = joinEntry({ vimKeys: "gJ" }, { action: "JoinLines" });
          entry.semantics = {
            vscodevim: "Runs VSCodeVim gJ.",
            ideavim: "IdeaVim's own gJ joins the lines as well.",
          };
          fileOf(files, "code").data.commands.push(entry);
        },
        expected: [
          diagnostic(
            CODE,
            "code.join",
            "MISSING_DEVIATION",
            'keys.vim[0] "gJ" is remapped in IntelliJ, so "deviation" is required',
          ),
        ],
      },
    ]);
  });

  test("MISSING_SEMANTICS reports engine keys in one IDE and a command in the other without semantics for both engines", () => {
    runCases([
      {
        name: "engine keys in both IDEs",
        change: (files) => {
          fileOf(files, "code").data.commands.push(
            joinEntry({ vimKeys: "gJ" }, { ideavimKeys: "gJ" }),
          );
        },
        expected: [],
      },
      {
        name: "engine keys in the only IDE that supports the entry",
        change: (files) => {
          const entry = newEntry("window.swap", "SPC w x", "Swap splits");
          delete entry.vscode;
          entry.intellij = { ideavimKeys: "<C-w>x" };
          entry.support = {
            vscode: { level: "none", note: "VS Code cannot swap groups." },
          };
          fileOf(files, "window").data.commands.push(entry);
        },
        expected: [],
      },
      {
        name: "IdeaVim keys and a command, without semantics",
        change: (files) => {
          delete entryOf(files, "window.focus-left").semantics;
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.focus-left",
            "MISSING_SEMANTICS",
            'IntelliJ runs IdeaVim keys and VS Code a command, so "semantics.ideavim" is required',
          ),
          diagnostic(
            WINDOW,
            "window.focus-left",
            "MISSING_SEMANTICS",
            'IntelliJ runs IdeaVim keys and VS Code a command, so "semantics.vscodevim" is required',
          ),
        ],
      },
      {
        name: "IdeaVim keys and a command, with semantics for IdeaVim only",
        change: (files) => {
          entryOf(files, "window.focus-left").semantics = {
            ideavim: "Runs IdeaVim <C-w>h.",
          };
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.focus-left",
            "MISSING_SEMANTICS",
            'IntelliJ runs IdeaVim keys and VS Code a command, so "semantics.vscodevim" is required',
          ),
        ],
      },
      {
        name: "VSCodeVim keys and an action, with semantics for the other engine",
        change: (files) => {
          entryOf(files, "window.only").semantics = {
            ideavim: "Runs the UnsplitAll action.",
          };
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.only",
            "MISSING_SEMANTICS",
            'VS Code runs VSCodeVim keys and IntelliJ an action, so "semantics.vscodevim" is required',
          ),
        ],
      },
      {
        name: "VSCodeVim keys and an action, with semantics for VSCodeVim only",
        change: (files) => {
          entryOf(files, "window.only").semantics = {
            vscodevim: "Runs VSCodeVim <C-w>o.",
          };
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.only",
            "MISSING_SEMANTICS",
            'VS Code runs VSCodeVim keys and IntelliJ an action, so "semantics.ideavim" is required',
          ),
        ],
      },
      {
        name: "keys of an IdeaVim extension and a command, without semantics",
        change: (files) => {
          delete entryOf(files, "code.comment").semantics;
        },
        expected: [
          diagnostic(
            CODE,
            "code.comment",
            "MISSING_SEMANTICS",
            'IntelliJ runs IdeaVim keys and VS Code a command, so "semantics.ideavim" is required',
          ),
          diagnostic(
            CODE,
            "code.comment",
            "MISSING_SEMANTICS",
            'IntelliJ runs IdeaVim keys and VS Code a command, so "semantics.vscodevim" is required',
          ),
        ],
      },
    ]);
  });

  test("SUPPORT reports support levels that disagree with the IDE blocks or lack a note", () => {
    runCases([
      {
        name: "full support written out",
        change: (files) => {
          entryOf(files, "file.find").support = {
            vscode: { level: "full" },
            intellij: { level: "full" },
          };
        },
        expected: [],
      },
      {
        name: "no IntelliJ block and no support level",
        change: (files) => {
          delete entryOf(files, "window.move-left").support;
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.move-left",
            "SUPPORT",
            'the entry has no "intellij" block, so "support.intellij.level" must be "none"',
          ),
        ],
      },
      {
        name: "an IntelliJ block with level none",
        change: (files) => {
          entryOf(files, "file.find").support = {
            intellij: { level: "none", note: "Not yet." },
          };
        },
        expected: [
          diagnostic(
            FILE,
            "file.find",
            "SUPPORT",
            '"support.intellij.level" is "none" although the entry has the "intellij" block',
          ),
        ],
      },
      {
        name: "partial support without a note",
        change: (files) => {
          entryOf(files, "file.recent").support = {
            vscode: { level: "partial" },
          };
        },
        expected: [
          diagnostic(
            FILE,
            "file.recent",
            "SUPPORT",
            '"support.vscode" with level "partial" needs a note',
          ),
        ],
      },
      {
        name: "level none without a note",
        change: (files) => {
          entryOf(files, "window.move-left").support = {
            intellij: { level: "none" },
          };
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.move-left",
            "SUPPORT",
            '"support.intellij" with level "none" needs a note',
          ),
        ],
      },
      {
        name: "an entry that neither IDE supports",
        change: (files) => {
          const entry = entryOf(files, "window.move-left");
          delete entry.vscode;
          entry.support = {
            vscode: { level: "none", note: "Not yet." },
            intellij: { level: "none", note: "Not yet." },
          };
        },
        expected: [
          diagnostic(
            WINDOW,
            "window.move-left",
            "SUPPORT",
            "the entry is supported in neither IDE",
          ),
        ],
      },
    ]);
  });

  test("MOTION_MODE reports an IntelliJ action that is not motion-safe in Visual mode", () => {
    const MESSAGE =
      '"intellij.motionSafe" is false: IdeaVim cannot run the action in Visual mode, so "modes" must not contain "x"';
    runCases([
      {
        name: "a motion-safe action in Visual mode",
        change: (files) => {
          entryOf(files, "code.action").intellij = {
            action: "ShowIntentionActions",
            motionSafe: true,
          };
        },
        expected: [],
      },
      {
        name: "a motion action in Normal and Visual mode",
        change: (files) => {
          entryOf(files, "diag.next").modes = ["n", "x"];
        },
        expected: [diagnostic(DIAG, "diag.next", "MOTION_MODE", MESSAGE)],
      },
      {
        name: "an entry in Visual mode whose action becomes a motion",
        change: (files) => {
          entryOf(files, "search.project").intellij = {
            action: "FindInPath",
            motionSafe: false,
          };
        },
        expected: [
          diagnostic(SEARCH, "search.project", "MOTION_MODE", MESSAGE),
        ],
      },
    ]);
  });

  test("ALIAS reports aliases with the entry's own key, no primary key of their kind, a long label or an until that is not a version", () => {
    const NOT_VERSION = "is not a version x.y.z[-prerelease]";
    runCases([
      {
        name: "prerelease versions and a label of 24 characters",
        change: (files) => {
          const next = entryOf(files, "diag.next");
          next.keys.vim = ["<C-w><C-w><C-w>"];
          next.aliases![0]!.until = "1.0.0-rc.1";
          entryOf(files, "search.project").aliases![0]!.until = "0.0.0-dev.1";
        },
        expected: [],
      },
      {
        name: "an alias with the entry's own key",
        change: (files) => {
          entryOf(files, "search.project").aliases![0]!.keys.leader = ["SPC /"];
        },
        expected: [
          diagnostic(
            SEARCH,
            "search.project",
            "ALIAS",
            `aliases[0].keys.leader[0] "SPC /" is the entry's own key`,
          ),
        ],
      },
      {
        name: "an alias with the entry's own key, with other case inside <...>",
        change: (files) => {
          const next = entryOf(files, "diag.next");
          next.keys.vim = ["<C-w>x"];
          next.aliases![0]!.keys.vim = ["<c-W>x"];
        },
        expected: [
          diagnostic(
            DIAG,
            "diag.next",
            "ALIAS",
            `aliases[0].keys.vim[0] "<c-W>x" is the entry's own key`,
          ),
        ],
      },
      {
        name: "a Vim alias of an entry with leader keys only",
        change: (files) => {
          entryOf(files, "file.find").aliases = [
            { keys: { vim: ["gf"] }, until: "1.0.0" },
          ];
        },
        expected: [
          diagnostic(
            FILE,
            "file.find",
            "ALIAS",
            'aliases[0].keys.vim needs a primary Vim key for its label "Moved to <key>"',
          ),
        ],
      },
      {
        name: "an alias label longer than 24 characters",
        change: (files) => {
          entryOf(files, "diag.next").keys.vim = ["<C-w><C-w><C-w>x"];
        },
        expected: [
          diagnostic(
            DIAG,
            "diag.next",
            "ALIAS",
            'aliases[0].keys.vim: the label "Moved to <C-w><C-w><C-w>x" is longer than 24 characters',
          ),
        ],
      },
      {
        name: "until values that are not versions",
        change: (files) => {
          entryOf(files, "search.project").aliases = [
            { keys: { leader: ["SPC f s"] }, until: "1.0" },
            { keys: { leader: ["SPC f t"] }, until: "1.0.0+build" },
            { keys: { leader: ["SPC f u"] }, until: "01.0.0" },
            { keys: { leader: ["SPC f v"] }, until: "1.0.0-" },
            { keys: { leader: ["SPC f w"] }, until: "1.0.0-01" },
          ];
        },
        expected: [
          diagnostic(
            SEARCH,
            "search.project",
            "ALIAS",
            `aliases[0].until "1.0" ${NOT_VERSION}`,
          ),
          diagnostic(
            SEARCH,
            "search.project",
            "ALIAS",
            `aliases[1].until "1.0.0+build" ${NOT_VERSION}`,
          ),
          diagnostic(
            SEARCH,
            "search.project",
            "ALIAS",
            `aliases[2].until "01.0.0" ${NOT_VERSION}`,
          ),
          diagnostic(
            SEARCH,
            "search.project",
            "ALIAS",
            `aliases[3].until "1.0.0-" ${NOT_VERSION}`,
          ),
          diagnostic(
            SEARCH,
            "search.project",
            "ALIAS",
            `aliases[4].until "1.0.0-01" ${NOT_VERSION}`,
          ),
        ],
      },
    ]);
  });

  test("RETIRED_ID reports an entry with an id from retired-ids.json", () => {
    runCases([
      {
        name: "an id that starts with a retired id",
        change: (files) => {
          fileOf(files, "file").data.commands.push(
            newEntry("file.old-files", "SPC f o", "Open old files"),
          );
        },
        expected: [],
      },
      {
        name: "a retired id",
        change: (files) => {
          fileOf(files, "file").data.commands.push(
            newEntry("file.old", "SPC f o", "Open old file"),
          );
        },
        expected: [
          diagnostic(
            FILE,
            "file.old",
            "RETIRED_ID",
            `the id is listed in ${RETIRED_IDS}, so no entry may use it again`,
          ),
        ],
      },
    ]);
  });

  test("CTRL_KEY reports Ctrl keys that are malformed or listed twice, and handlers IdeaVim cannot split", () => {
    const HANDLERS =
      'must be mode:vim or mode:ide tokens such as "a:vim" or "n-v:ide", separated by single spaces';
    runCases([
      {
        name: "mode lists and both handlers",
        change: (files) => {
          files.ctrlKeys.data.keys.push(
            { key: "<C-v>", handler: "n-v:vim i:ide", mac: "a:vim" },
            { key: "<C-f>", handler: "a:vim i-c-s:ide" },
          );
        },
        expected: [],
      },
      {
        name: "keys that are not Ctrl and a lowercase letter",
        change: (files) => {
          files.ctrlKeys.data.keys.push(
            { key: "<C-A>", handler: "a:vim" },
            { key: "<c-b>", handler: "a:vim" },
          );
        },
        expected: [
          diagnostic(
            CTRL_KEYS,
            "<C-A>",
            "CTRL_KEY",
            "the key must be <C-x> with a lowercase letter x",
          ),
          diagnostic(
            CTRL_KEYS,
            "<c-b>",
            "CTRL_KEY",
            "the key must be <C-x> with a lowercase letter x",
          ),
        ],
      },
      {
        name: "a key listed twice",
        change: (files) => {
          files.ctrlKeys.data.keys.push({ key: "<C-a>", handler: "n:vim" });
        },
        expected: [
          diagnostic(
            CTRL_KEYS,
            "<C-a>",
            "CTRL_KEY",
            "the key is already listed",
          ),
        ],
      },
      {
        name: "handlers with two spaces or an unknown mode",
        change: (files) => {
          files.ctrlKeys.data.keys.push(
            { key: "<C-x>", handler: "a:vim  x:ide" },
            { key: "<C-y>", handler: "a:vim", mac: "o:ide" },
          );
        },
        expected: [
          diagnostic(
            CTRL_KEYS,
            "<C-x>",
            "CTRL_KEY",
            `handler "a:vim  x:ide" ${HANDLERS}`,
          ),
          diagnostic(CTRL_KEYS, "<C-y>", "CTRL_KEY", `mac "o:ide" ${HANDLERS}`),
        ],
      },
    ]);
  });
});
