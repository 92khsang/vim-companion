// The invariants of design §7.5 over generated catalogs. Each catalog is a random part of a pool of
// entries that fit together, with random stages, modes and Ctrl keys, read at a random version.
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type {
  Catalog,
  CtrlKey,
  Entry,
  Group,
  Ide,
  Mode,
  VscodeBinding,
} from "../tools/core/catalog.mts";
import { genIde } from "../tools/core/gen.mts";
import { boundKeys } from "../tools/core/resolve.mts";
import { validateCatalog, type CatalogFiles } from "../tools/core/validate.mts";
import { loadSchemas } from "./support/mini-catalog.mts";

function entry(
  fields: Pick<Entry, "id" | "keys" | "label"> & Partial<Entry>,
): Entry {
  return {
    category: fields.id.slice(0, fields.id.indexOf(".")),
    description: `${fields.label}.`,
    examples: [`${fields.label} → done`],
    rationale: "A mnemonic of its group.",
    stage: "stable",
    verifiedAgainst: {
      vscode: "1.141.0",
      vscodevim: "1.32.4",
      intellij: "2026.2.3",
      ideavim: "2.47.3",
    },
    ...fields,
  };
}

function command(id: string, args?: unknown[]): VscodeBinding {
  return {
    exec: args === undefined ? { command: id } : { command: id, args },
    exit: "editor",
    repeatable: false,
    count: "none",
  };
}

function vimKeys(keys: string): VscodeBinding {
  return {
    exec: { vimKeys: keys },
    exit: "editor",
    repeatable: false,
    count: "none",
  };
}

const deviation = {
  shadows: "A key of Vim",
  origin: "Neovim default mapping",
  note: "Runs the IDE feature instead.",
};

/** Entries whose keys never clash, with each kind of binding, alias, label and argument list. */
const POOL: readonly Entry[] = [
  entry({
    id: "file.find",
    keys: { leader: ["SPC f f", "SPC SPC"] },
    label: "Find file",
    vscode: command("workbench.action.quickOpen"),
    intellij: { action: "GotoFile" },
  }),
  entry({
    id: "file.recent",
    keys: { leader: ["SPC f r"] },
    label: "Open recent file",
    vscode: command("workbench.action.quickOpen", ["recent"]),
    intellij: { action: "RecentFiles" },
    support: { vscode: { level: "partial", note: "Lists open editors too." } },
  }),
  entry({
    id: "file.locations",
    keys: { leader: ["SPC f l"] },
    label: "Show recent locations",
    intellij: { action: "RecentLocations" },
    support: { vscode: { level: "none", note: "No list of locations." } },
  }),
  entry({
    id: "search.project",
    keys: { leader: ["SPC /"] },
    label: "Search in project",
    aliases: [{ keys: { leader: ["SPC f s"] }, until: "1.0.0" }],
    vscode: command("workbench.action.findInFiles", [{ query: "" }]),
    intellij: { action: "FindInPath" },
  }),
  entry({
    id: "code.action",
    keys: { vim: ["gra"], leader: ["SPC c a"] },
    label: "Show code actions",
    vscode: command("editor.action.quickFix"),
    intellij: { action: "ShowIntentionActions" },
    deviation,
  }),
  entry({
    id: "code.hover",
    keys: { vim: ["K"], leader: ["SPC c d"] },
    label: "Show documentation",
    vscode: command("editor.action.showHover"),
    intellij: { ideavimKeys: "K" },
    semantics: { ideavim: "Runs Quick Documentation." },
    deviation,
  }),
  entry({
    id: "code.comment",
    keys: { leader: ["SPC c c"], vim: ["gcc"] },
    label: "Toggle line comment",
    vscode: vimKeys("gcc"),
    intellij: { ideavimKeys: "gcc", provider: "commentary" },
  }),
  entry({
    id: "diag.next",
    keys: { vim: ["]d"] },
    label: "Go to next problem",
    aliases: [{ keys: { vim: ["]e"] }, until: "1.0.0" }],
    vscode: command("editor.action.marker.next", [0]),
    intellij: { action: "GotoNextError", motionSafe: false },
    deviation,
  }),
  entry({
    id: "edit.yank-eol",
    keys: { vim: ["Y"] },
    label: "Yank to end of line",
    vscode: vimKeys("y$"),
    intellij: { ideavimKeys: "y$" },
    deviation,
  }),
  entry({
    id: "nav.mark-next",
    keys: { vim: ["]'"] },
    label: "Go to next mark's line",
    intellij: { action: "GotoNextBookmark" },
    support: { vscode: { level: "none", note: "No marks." } },
    deviation,
  }),
  entry({
    id: "tab.close",
    keys: { leader: ["SPC b d"] },
    label: "Close the tab's editor",
    aliases: [{ keys: { leader: ["SPC b c"] }, until: "2.0.0" }],
    vscode: command("workbench.action.closeActiveEditor", ["a", 2]),
    intellij: { action: "CloseContent" },
  }),
  entry({
    id: "tab.pin",
    keys: { leader: ["SPC b p"] },
    label: "Pin tab",
    vscode: command("workbench.action.pinEditor", [["x", "y"]]),
    intellij: { action: "PinActiveTabToggle" },
  }),
  entry({
    id: "window.focus-left",
    keys: { leader: ["SPC w h"] },
    label: "Focus split left",
    vscode: command("workbench.action.focusLeftGroup", [false]),
    intellij: { ideavimKeys: "<C-w>h" },
    semantics: { ideavim: "Takes a count." },
  }),
  entry({
    id: "window.only",
    keys: { leader: ["SPC w o"] },
    label: "Close other splits",
    vscode: vimKeys("<C-w>o"),
    intellij: { action: "UnsplitAll" },
    semantics: { vscodevim: "Closes the other editor groups." },
  }),
  entry({
    id: "window.move-left",
    keys: { leader: ["SPC w m h"] },
    label: "Move split left",
    vscode: command("workbench.action.moveActiveEditorGroupLeft"),
    support: {
      intellij: { level: "none", note: "No action\nmoves a split. " },
    },
  }),
  entry({
    id: "git.status",
    keys: { leader: ["SPC g g"] },
    label: "Show Git changes",
    vscode: command("workbench.view.scm"),
    intellij: { action: "ActivateCommitToolWindow" },
  }),
];

const GROUP_LABELS: Record<string, string> = {
  "SPC b": "Buffer",
  "SPC c": "Code",
  "SPC f": "File",
  "SPC g": "Git",
  "SPC w": "Window",
  "SPC w m": "Move",
};

const CTRL_KEYS: readonly CtrlKey[] = [
  { key: "<C-a>", handler: "a:vim" },
  { key: "<C-c>", handler: "a:vim x:ide", mac: "a:vim" },
  { key: "<C-f>", handler: "a:vim i:ide", mac: "a:vim" },
  { key: "<C-w>", handler: "a:vim" },
];

/** A catalog of the entries with a group for each prefix of their leader keys. */
function catalogOf(entries: Entry[], ctrlKeys: CtrlKey[]): Catalog {
  const prefixes = entries.flatMap((entry) =>
    [entry.keys, ...(entry.aliases ?? []).map(({ keys }) => keys)].flatMap(
      (keys) =>
        (keys.leader ?? []).flatMap((key) => {
          const tokens = key.split(" ");
          return tokens
            .slice(2)
            .map((_, i) => tokens.slice(0, i + 2).join(" "));
        }),
    ),
  );
  const groups: Group[] = [...new Set(prefixes)].map((keys) => ({
    keys,
    label: GROUP_LABELS[keys]!,
  }));
  return { entries, groups, ctrlKeys, retiredIds: [] };
}

const MODES: readonly (Mode[] | undefined)[] = [
  undefined,
  ["n"],
  ["x"],
  ["n", "x"],
  ["x", "n"],
];

/** A part of the pool, each entry stable or experimental and in random modes, and a version. */
const generated = fc
  .record({
    choices: fc.tuple(
      ...POOL.map(() =>
        fc.record({
          include: fc.boolean(),
          experimental: fc.boolean(),
          modes: fc.constantFrom(...MODES),
        }),
      ),
    ),
    ctrlKeys: fc.subarray([...CTRL_KEYS]),
    version: fc.constantFrom("0.0.0", "1.0.0-rc.1", "1.0.0", "2.0.0"),
  })
  .map(({ choices, ctrlKeys, version }) => {
    const entries = POOL.flatMap((base, i): Entry[] => {
      const { include, experimental, modes } = choices[i]!;
      if (!include) return [];
      const changed: Entry = { ...base };
      if (experimental) changed.stage = "experimental";
      // An action that acts as a motion stays out of Visual mode (rule MOTION_MODE).
      if (modes !== undefined && base.intellij?.motionSafe !== false) {
        changed.modes = modes;
      }
      return [changed];
    });
    return { catalog: catalogOf(entries, ctrlKeys), version };
  });

/** The catalog as command files by category and the other catalog files. */
function filesOf(catalog: Catalog): CatalogFiles {
  const categories = [...new Set(catalog.entries.map((e) => e.category))];
  return {
    commands: categories.map((category) => ({
      path: `spec/catalog/commands/${category}.json`,
      data: {
        commands: catalog.entries.filter((e) => e.category === category),
      },
    })),
    groups: {
      path: "spec/catalog/groups.json",
      data: { groups: catalog.groups },
    },
    ctrlKeys: {
      path: "spec/catalog/ctrl-keys.json",
      data: { keys: catalog.ctrlKeys },
    },
    retiredIds: { path: "spec/catalog/retired-ids.json", data: { ids: [] } },
  };
}

const supported = (entry: Entry, ide: Ide) =>
  entry[ide] !== undefined && entry.support?.[ide]?.level !== "none";

/** The texts of genIde for the catalog at the version. */
function texts(catalog: Catalog, version: string) {
  const out = genIde(catalog, { version });
  return {
    rc: out.get("intellij/vim-companion.ideavimrc")!,
    remaps: out.get("vscode/vim-remaps.json")!,
    menu: out.get("vscode/whichkey-bindings.json")!,
  };
}

/** A which-key menu item, as far as the tests look at it. */
type MenuItem = { key: string; name: string; bindings?: MenuItem[] };

/** The leaves of a which-key menu as [leader key, name], such as ["SPC f f", "Find file"]. */
function menuLeaves(
  items: readonly MenuItem[],
  prefix: readonly string[] = ["SPC"],
): [string, string][] {
  return items.flatMap((item) => {
    const tokens = [...prefix, item.key === " " ? "SPC" : item.key];
    return item.bindings === undefined
      ? [[tokens.join(" "), item.name] as [string, string]]
      : menuLeaves(item.bindings, tokens);
  });
}

/** The leader key descriptions of the entries in an rc as [leader key, label]. */
function rcDescriptions(rc: string): [string, string][] {
  return rc.split("\n").flatMap((line): [string, string][] => {
    const match =
      /^ {2}let g:WhichKeyDesc_vimcompanion_\w+ = '<leader>(\S*) (.*)'$/.exec(
        line.replaceAll("''", "'"),
      );
    if (match === null) return [];
    // After <leader>, each key is one character or <Space>.
    const keys = [...match[1]!.matchAll(/<Space>|./g)].map(([key]) =>
      key === "<Space>" ? "SPC" : key,
    );
    return [[["SPC", ...keys].join(" "), match[2]!]];
  });
}

describe("genIde on generated catalogs", () => {
  test("the pool and the catalogs made from it pass the catalog checks", () => {
    const schemas = loadSchemas();
    expect(
      validateCatalog(filesOf(catalogOf([...POOL], [...CTRL_KEYS])), schemas)
        .diagnostics,
    ).toEqual([]);
    fc.assert(
      fc.property(generated, ({ catalog }) => {
        expect(validateCatalog(filesOf(catalog), schemas).diagnostics).toEqual(
          [],
        );
      }),
      { numRuns: 50 },
    );
  });

  test("the rc maps only in guarded nmap, xmap, nnoremap and xnoremap lines below the leader", () => {
    fc.assert(
      fc.property(generated, ({ catalog, version }) => {
        const lines = texts(catalog, version).rc.split("\n");
        const maps = lines.flatMap((line, i) => {
          const match = /^ {2}([nx])(nore)?map (\S+) (\S+)$/.exec(line);
          return match === null ? [] : [{ i, match }];
        });
        for (const { i, match } of maps) {
          const [, mode, nore, lhs, rhs] = match;
          const quoted = `'${lhs!.replaceAll("'", "''")}'`;
          expect(lines[i - 1]).toBe(`if empty(mapcheck(${quoted}, '${mode}'))`);
          // IdeaVim runs <Action>(…) only from a recursive map.
          if (nore !== undefined) expect(rhs).not.toMatch(/^<Action>\(/);
        }
        // Every map command is one of those lines; map and vmap would cover Select mode too.
        expect(lines.filter((line) => /^\s*\w*map\s/.test(line)).length).toBe(
          maps.length,
        );
        expect(lines.filter((line) => /^\s*(map|vmap)\s/.test(line))).toEqual(
          [],
        );
        const leader = lines.indexOf("if !exists('g:mapleader')");
        const first = lines.findIndex((line) => line.includes("<leader>"));
        expect(leader).toBeGreaterThanOrEqual(0);
        if (first >= 0) expect(leader).toBeLessThan(first);
      }),
    );
  });

  test("sethandler lines have single spaces and no file has trailing whitespace", () => {
    fc.assert(
      fc.property(generated, ({ catalog, version }) => {
        const { rc, remaps, menu } = texts(catalog, version);
        for (const line of rc.split("\n")) {
          if (/^\s*sethandler/.test(line)) {
            expect(line).toMatch(/^(?: {2})?sethandler(?: \S+)+$/);
          }
        }
        for (const text of [rc, remaps, menu]) {
          expect(text).toMatch(/[^\n]\n$/);
          expect(text.split("\n").filter((line) => /\s$/.test(line))).toEqual(
            [],
          );
          expect(text).not.toContain("\r");
        }
        expect(() => JSON.parse(remaps)).not.toThrow();
        expect(() => JSON.parse(menu)).not.toThrow();
      }),
    );
  });

  test("the which-key menu holds each active leader key of VS Code once", () => {
    fc.assert(
      fc.property(generated, ({ catalog, version }) => {
        const menu = JSON.parse(texts(catalog, version).menu) as MenuItem[];
        const keys = boundKeys(catalog, "leader", { version })
          .filter(({ entry }) => supported(entry, "vscode"))
          .map(({ key }) => key);
        expect(
          menuLeaves(menu)
            .map(([key]) => key)
            .sort(),
        ).toEqual(keys.sort());
      }),
    );
  });

  test("a leader key that both IDEs support has the same label in the which-key menu and the rc", () => {
    fc.assert(
      fc.property(generated, ({ catalog, version }) => {
        const { rc, menu } = texts(catalog, version);
        const both = new Set(
          boundKeys(catalog, "leader", { version })
            .filter(
              ({ entry }) =>
                supported(entry, "vscode") && supported(entry, "intellij"),
            )
            .map(({ key }) => key),
        );
        const pairs = (list: [string, string][]) =>
          list.filter(([key]) => both.has(key)).sort();
        const fromRc = pairs(rcDescriptions(rc));
        expect(fromRc.map(([key]) => key).sort()).toEqual([...both].sort());
        expect(pairs(menuLeaves(JSON.parse(menu) as MenuItem[]))).toEqual(
          fromRc,
        );
      }),
    );
  });

  test("the files do not depend on the order of the entries, groups and Ctrl keys", () => {
    const permutation = <T,>(items: readonly T[]) =>
      fc.shuffledSubarray([...items], {
        minLength: items.length,
        maxLength: items.length,
      });
    fc.assert(
      fc.property(
        generated.chain(({ catalog, version }) =>
          fc.record({
            catalog: fc.constant(catalog),
            version: fc.constant(version),
            shuffled: fc.record({
              entries: permutation(catalog.entries),
              groups: permutation(catalog.groups),
              ctrlKeys: permutation(catalog.ctrlKeys),
              retiredIds: fc.constant<string[]>([]),
            }),
          }),
        ),
        ({ catalog, version, shuffled }) => {
          expect(genIde(shuffled, { version })).toEqual(
            genIde(catalog, { version }),
          );
        },
      ),
    );
  });
});
