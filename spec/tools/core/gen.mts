// The IDE files that pnpm gen writes from the catalog (design §6, §7): the which-key menu and the
// VSCodeVim remaps for VS Code, and an IdeaVim rc for IntelliJ. Every list follows the display
// order of rows(): at each leader prefix the entry keys, the alias keys, then the groups.
import type {
  Catalog,
  CtrlKey,
  Entry,
  Ide,
  Mode,
  VscodeExec,
} from "./catalog.mts";
import {
  compareKeys,
  ideavimLhs,
  parseVim,
  vscodevimBefore,
  whichKeyKey,
} from "./keys.mts";
import { boundKeys, leaderLeaves } from "./resolve.mts";
import { entryRows } from "./rows.mts";

/** The files that genIde returns, relative to spec/generated/, in the order it returns them. */
export const GENERATED_PATHS = [
  "intellij/vim-companion.ideavimrc",
  "vscode/vim-remaps.json",
  "vscode/whichkey-bindings.json",
] as const;

export type GeneratedPath = (typeof GENERATED_PATHS)[number];

/** `version`: the release whose aliases are active; "0.0.0" by default. */
export type GenOptions = { version?: string };

/** The text of each file of GENERATED_PATHS, in that order. The catalog must be valid. */
export function genIde(
  catalog: Catalog,
  options: GenOptions = {},
): Map<string, string> {
  const version = options.version ?? "0.0.0";
  // Entries that bind one key in different modes follow their ids, never the catalog order.
  const byId: Catalog = {
    ...catalog,
    entries: [...catalog.entries].sort((a, b) => compareText(a.id, b.id)),
  };
  return new Map(
    GENERATED_PATHS.map((path) => [path, GENERATORS[path](byId, version)]),
  );
}

const GENERATORS: Record<
  GeneratedPath,
  (catalog: Catalog, version: string) => string
> = {
  "intellij/vim-companion.ideavimrc": ideavimrc,
  "vscode/vim-remaps.json": vimRemaps,
  "vscode/whichkey-bindings.json": whichKeyBindings,
};

/** The commands that the generated files run besides those of the catalog, for check-ids. */
export function generatedCommandIds(catalog: Catalog): string[] {
  return [];
}

/**
 * The `args` of a which-key item or of a VSCodeVim remap command for the positional arguments of
 * a command. Both spread a list into positional arguments and drop a falsy value, so one truthy
 * argument that is not a list stands alone and any other arguments go in a list.
 */
export function whichKeyArgs(args: readonly unknown[]): { args?: unknown } {
  if (args.length === 0) return {};
  if (args.length === 1 && !Array.isArray(args[0]) && Boolean(args[0])) {
    return { args: args[0] };
  }
  return { args: [...args] };
}

/** A key that a file binds: a leader key or a Vim key of an entry or of one of its aliases. */
type Leaf = {
  kind: "leaf";
  /** The key as the catalog writes it, such as "SPC f f" or "]d". */
  key: string;
  tokens: string[];
  /** The entry label, or "Moved to <primary key>" for an alias key. */
  label: string;
  entry: Entry;
};

/** A leader prefix with a group label and the keys below it. */
type GroupNode = {
  kind: "group";
  tokens: string[];
  label: string;
  children: Node[];
};

type Node = Leaf | GroupNode;

/**
 * The children of a leader prefix (the keys after SPC) in an IDE, in display order, with the
 * aliases that are active in the version.
 */
function leaderTree(
  catalog: Catalog,
  ide: Ide,
  version: string,
  prefix: readonly string[] = [],
): Node[] {
  return entryRows(catalog, ide, prefix, { version }).map(
    ({ row, entry }): Node => {
      const keys = [...prefix, row.key];
      const tokens = ["SPC", ...keys];
      if (entry === undefined) {
        return {
          kind: "group",
          tokens,
          label: row.label,
          children: leaderTree(catalog, ide, version, keys),
        };
      }
      const key = tokens.join(" ");
      return { kind: "leaf", key, tokens, label: row.label, entry };
    },
  );
}

/** The leaves below the nodes in display order. */
function leavesOf(nodes: readonly Node[]): Leaf[] {
  return nodes.flatMap((node) =>
    node.kind === "group" ? leavesOf(node.children) : [node],
  );
}

/**
 * The Vim keys of the stable entries, then those of their aliases that are active in the version,
 * each sorted by key.
 */
function vimLeaves(catalog: Catalog, version: string): Leaf[] {
  const bound = boundKeys(catalog, "vim", { version });
  const leaves = (alias: boolean): Leaf[] =>
    bound
      .filter((key) => key.alias === alias)
      .map(({ key, entry }): Leaf => ({
        kind: "leaf",
        key,
        tokens: vimTokens(key),
        // An alias moves its key to the entry's first Vim key.
        label: alias ? `Moved to ${entry.keys.vim?.[0]}` : entry.label,
        entry,
      }))
      .sort((a, b) => compareKeys(a.tokens, b.tokens));
  return [...leaves(false), ...leaves(true)];
}

/** The tokens of a Vim key, which the catalog validation has checked. */
function vimTokens(key: string): string[] {
  const parsed = parseVim(key);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.tokens;
}

/** The entry's block for the IDE when the IDE supports the entry. */
function bindingIn<I extends Ide>(entry: Entry, ide: I): Entry[I] | undefined {
  return entry.support?.[ide]?.level === "none" ? undefined : entry[ide];
}

/** The modes of an entry, Normal before Visual; "n" when it has none. */
function modesOf(entry: Entry): readonly Mode[] {
  const modes = entry.modes ?? ["n"];
  return (["n", "x"] as const).filter((mode) => modes.includes(mode));
}

/** JSON with two-space indentation and a final newline. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// VS Code: which-key menu (vscode/whichkey-bindings.json)

/** An item of the `whichkey.bindings` setting of which-key 0.11.4. */
type WhichKeyItem =
  | {
      key: string;
      name: string;
      type: "command";
      command: string;
      args?: unknown;
    }
  | { key: string; name: string; type: "bindings"; bindings: WhichKeyItem[] };

/**
 * The value of `whichkey.bindings`: the leader keys that VS Code supports. which-key has no modes,
 * so it throws when two entries bind one key in different modes.
 */
function whichKeyBindings(catalog: Catalog, version: string): string {
  const keys = leaderLeaves(catalog, { version }).filter(
    ({ entry }) => bindingIn(entry, "vscode") !== undefined,
  );
  const clashes = keys
    .flatMap(({ key, entry }) =>
      keys
        .filter((other) => other.key === key && entry.id < other.entry.id)
        .map(
          (other) =>
            `${key}: ${entry.id} and ${other.entry.id} bind it in different modes, which which-key cannot tell apart`,
        ),
    )
    .sort();
  if (clashes.length > 0) throw new Error(clashes.join("\n"));
  return json(whichKeyItems(leaderTree(catalog, "vscode", version)));
}

function whichKeyItems(nodes: readonly Node[]): WhichKeyItem[] {
  return nodes.flatMap((node): WhichKeyItem[] => {
    const key = whichKeyKey(node.tokens[node.tokens.length - 1]!);
    if (node.kind === "group") {
      const bindings = whichKeyItems(node.children);
      if (bindings.length === 0) return [];
      return [{ key, name: node.label, type: "bindings", bindings }];
    }
    const vscode = bindingIn(node.entry, "vscode");
    if (vscode === undefined) return [];
    return [
      { key, name: node.label, type: "command", ...whichKeyCall(vscode.exec) },
    ];
  });
}

/** How which-key runs an exec: its command, or vim.remap with the Vim keys. */
function whichKeyCall(exec: VscodeExec): { command: string; args?: unknown } {
  if ("vimKeys" in exec) {
    return { command: "vim.remap", args: { after: vimTokens(exec.vimKeys) } };
  }
  return { command: exec.command, ...whichKeyArgs(exec.args ?? []) };
}

// VS Code: VSCodeVim remaps (vscode/vim-remaps.json)

/** Space opens the which-key menu; through VSCodeVim, so that d<Space> and f<Space> still work. */
const OPEN_WHICH_KEY = { before: ["<space>"], commands: ["whichkey.show"] };

/** The Normal and Visual mode remaps of VSCodeVim 1.32.4 for the Vim keys VS Code supports. */
function vimRemaps(catalog: Catalog, version: string): string {
  const remaps: Record<Mode, object[]> = {
    n: [OPEN_WHICH_KEY],
    x: [OPEN_WHICH_KEY],
  };
  for (const leaf of vimLeaves(catalog, version)) {
    const vscode = bindingIn(leaf.entry, "vscode");
    const remap =
      vscode === undefined ? undefined : vimRemap(leaf, vscode.exec);
    if (remap === undefined) continue;
    for (const mode of modesOf(leaf.entry)) remaps[mode].push(remap);
  }
  return json({
    "vim.normalModeKeyBindingsNonRecursive": remaps.n,
    "vim.visualModeKeyBindingsNonRecursive": remaps.x,
  });
}

/** The remap of a Vim key; undefined when VSCodeVim runs the same keys itself. */
function vimRemap(leaf: Leaf, exec: VscodeExec): object | undefined {
  const before = vscodevimBefore(leaf.tokens);
  if ("vimKeys" in exec) {
    return exec.vimKeys === leaf.key
      ? undefined
      : { before, after: vimTokens(exec.vimKeys) };
  }
  const call = whichKeyArgs(exec.args ?? []);
  return {
    before,
    commands: [
      "args" in call ? { command: exec.command, ...call } : exec.command,
    ],
  };
}

// IntelliJ: IdeaVim rc (intellij/vim-companion.ideavimrc)

const HEADER = [
  '" vim-companion.ideavimrc: generated by `pnpm gen` from spec/catalog. Do not edit.',
  '" Source it from the last line of ~/.ideavimrc:',
  '"   source ~/.config/vim-companion/vim-companion.ideavimrc',
  '" Restart the IDE after changing it; Reload keeps the old g: variables and Ctrl-key handlers.',
];

/** The user's g:mapleader wins; without one, the leader is Space. */
const LEADER = [
  "if !exists('g:mapleader')",
  "  let g:mapleader = ' '",
  "endif",
];

/** The rc: the leader, the group descriptions, a block per key and mode, then the Ctrl keys. */
function ideavimrc(catalog: Catalog, version: string): string {
  const tree = leaderTree(catalog, "intellij", version);
  const sections = [
    HEADER,
    LEADER,
    ["let g:vimcompanion_skipped = []"],
    groupDescriptions(tree),
    ...[...leavesOf(tree), ...vimLeaves(catalog, version)].map(mapBlocks),
    ctrlKeyLines(catalog.ctrlKeys),
  ];
  // One blank line between the parts; a part without lines leaves none.
  return `${sections
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join("\n\n")}\n`;
}

/** The idea-which-key description of each group with a key that IntelliJ maps, depth first. */
function groupDescriptions(nodes: readonly Node[]): string[] {
  const mapped = (node: GroupNode) =>
    leavesOf(node.children).some(
      ({ entry }) => bindingIn(entry, "intellij") !== undefined,
    );
  return nodes.flatMap((node) =>
    node.kind === "group" && mapped(node)
      ? [
          `let g:WhichKeyDesc_vimcompanion_group_${keyHex(node.tokens)} = ${quote(`${ideavimLhs(node.tokens)} ${node.label}`)}`,
          ...groupDescriptions(node.children),
        ]
      : [],
  );
}

/**
 * The lines of a key: a comment and a guarded map per mode, with the description in the first; a
 * comment alone when IntelliJ does not support the entry; nothing when IdeaVim runs the key itself.
 */
function mapBlocks(leaf: Leaf): string[] {
  const { entry } = leaf;
  const intellij = bindingIn(entry, "intellij");
  if (intellij === undefined) {
    // On one line: after a line break, IdeaVim would run the rest of the note as a command.
    const note = (entry.support?.intellij?.note ?? "")
      .trim()
      .replace(/\s+/g, " ");
    return [`" ${entry.id}: unsupported in IntelliJ: ${note}`];
  }
  // IdeaVim runs <Action>(…) only from a recursive map; plugin keys need one too.
  let rhs: string;
  let map: string;
  if ("action" in intellij) {
    rhs = `<Action>(${intellij.action})`;
    map = "map";
  } else if (intellij.ideavimKeys === leaf.key) {
    return [];
  } else {
    rhs = intellij.ideavimKeys;
    map = intellij.provider === undefined ? "noremap" : "map";
  }
  const lhs = ideavimLhs(leaf.tokens);
  return [
    `" ${entry.id}`,
    ...modesOf(entry).flatMap((mode, i) => [
      `if empty(mapcheck(${quote(lhs)}, '${mode}'))`,
      `  ${mode}${map} ${lhs} ${rhs}`,
      ...(i === 0
        ? [`  let ${descriptionName(leaf)} = ${quote(`${lhs} ${leaf.label}`)}`]
        : []),
      "else",
      `  call add(g:vimcompanion_skipped, ${quote(`${mode} ${lhs} ${entry.id}`)})`,
      "endif",
    ]),
  ];
}

/** g:WhichKeyDesc_vimcompanion_<id, with _ for every other character>_<keyHex>. */
function descriptionName(leaf: Leaf): string {
  const id = leaf.entry.id.replace(/[^A-Za-z0-9]/g, "_");
  return `g:WhichKeyDesc_vimcompanion_${id}_${keyHex(leaf.tokens)}`;
}

/**
 * "l" and the hex of the UTF-8 bytes of the keys after the leader, a later SPC as a space, or "v"
 * and the hex of a Vim key: "l6666" for SPC f f, "l20" for SPC SPC, "v5d64" for ]d.
 */
function keyHex(tokens: readonly string[]): string {
  const leader = tokens[0] === "SPC";
  const text = (leader ? tokens.slice(1) : tokens).map(whichKeyKey).join("");
  const hex = [...new TextEncoder().encode(text)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${leader ? "l" : "v"}${hex}`;
}

/** A Vim single-quoted string: '' stands for each '. */
function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** sethandler lines sorted by key; the keys with a macOS value in one if has('mac') block. */
function ctrlKeyLines(keys: readonly CtrlKey[]): string[] {
  if (keys.length === 0) return [];
  const sorted = [...keys].sort((a, b) => compareText(a.key, b.key));
  const mac = sorted.filter((key) => key.mac !== undefined);
  return [
    '" Ctrl keys: which of the IDE and IdeaVim handles each key; modes left out go to IdeaVim.',
    ...sorted
      .filter((key) => key.mac === undefined)
      .map((key) => `sethandler ${key.key} ${key.handler}`),
    ...(mac.length === 0
      ? []
      : [
          "if has('mac')",
          ...mac.map((key) => `  sethandler ${key.key} ${key.mac}`),
          "else",
          ...mac.map((key) => `  sethandler ${key.key} ${key.handler}`),
          "endif",
        ]),
  ];
}

/** Code-unit order. */
function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
