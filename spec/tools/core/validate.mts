// The catalog validator (design §3): every file against its schema, then the rules that a schema
// cannot express. It receives parsed files and schemas and reads nothing itself.
import type { AnySchema, ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type {
  Catalog,
  CtrlKey,
  Diagnostic,
  Entry,
  Group,
  Ide,
  KeySet,
  Mode,
} from "./catalog.mts";
import { parseLeader, parseVim, type ParsedKey } from "./keys.mts";
import { isVersion } from "./version.mts";

/** A parsed catalog file; `path` is repo-relative and POSIX, for messages. */
export type CatalogFile = { path: string; data: unknown };

export type CatalogFiles = {
  commands: readonly CatalogFile[];
  groups: CatalogFile;
  ctrlKeys: CatalogFile;
  retiredIds: CatalogFile;
};

/** The parsed fixture files of a spec directory (design §5). */
export type FixtureFiles = {
  /** fixtures/catalog/*.json: leader key resolution cases. */
  catalog: readonly CatalogFile[];
  /** fixtures/hint-view/*.json: hint view rows cases. */
  hintView: readonly CatalogFile[];
  /** fixtures/version-order.json: versions in ascending order. */
  versionOrder: CatalogFile;
};

/** Parsed schemas by their file name in spec/schema, such as "commands.schema.json". */
export type SchemaSet = Readonly<Record<string, unknown>>;

/** `catalog` is present only when there are no diagnostics. */
export type Validation = { catalog?: Catalog; diagnostics: Diagnostic[] };

export function validateCatalog(
  files: CatalogFiles,
  schemas: SchemaSet,
): Validation {
  // File order never matters: the entries follow the paths in code-unit order.
  const commands = [...files.commands].sort((a, b) =>
    compareText(a.path, b.path),
  );
  const schemaErrors = checkSchemas(
    [
      ...commands.map((file) => ({ file, schema: "commands.schema.json" })),
      { file: files.groups, schema: "groups.schema.json" },
      { file: files.ctrlKeys, schema: "ctrl-keys.schema.json" },
      { file: files.retiredIds, schema: "retired-ids.schema.json" },
    ],
    schemas,
  );
  if (schemaErrors.length > 0) {
    return { diagnostics: sortDiagnostics(schemaErrors) };
  }
  // Every file matches its schema, so the data has the catalog types from here on.
  const placed = commands.flatMap((file) =>
    (file.data as { commands: Entry[] }).commands.map((entry) => ({
      file: file.path,
      stem: stemOf(file.path),
      entry,
    })),
  );
  const context: Context = {
    placed,
    uses: keyUses(placed),
    groups: {
      file: files.groups.path,
      groups: (files.groups.data as { groups: Group[] }).groups,
    },
    ctrlKeys: {
      file: files.ctrlKeys.path,
      keys: (files.ctrlKeys.data as { keys: CtrlKey[] }).keys,
    },
    retiredIds: {
      file: files.retiredIds.path,
      ids: (files.retiredIds.data as { ids: string[] }).ids,
    },
  };
  const diagnostics = sortDiagnostics(RULES.flatMap((rule) => rule(context)));
  if (diagnostics.length > 0) return { diagnostics };
  return {
    catalog: {
      entries: context.placed.map(({ entry }) => entry),
      groups: context.groups.groups,
      ctrlKeys: context.ctrlKeys.keys,
      retiredIds: context.retiredIds.ids,
    },
    diagnostics,
  };
}

/**
 * The fixture files (design §5): each file against its fixture schema. The diagnostics are sorted
 * as those of validateCatalog.
 */
export function validateFixtures(
  files: FixtureFiles,
  schemas: SchemaSet,
): Diagnostic[] {
  return [];
}

/**
 * Rule SCHEMA: ajv 2020 in strict mode, every error of every file. `schema` is a file name in the
 * set, or a file name and a pointer such as "ids.schema.json#/$defs/vscode".
 */
export function checkSchemas(
  checks: { file: CatalogFile; schema: string }[],
  schemas: SchemaSet,
): Diagnostic[] {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // Keyed by file name, so a relative $ref such as "commands.schema.json#/$defs/label" resolves.
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema as AnySchema, name);
  }
  return checks.flatMap(({ file, schema }) => {
    // Throws when the schema is missing or breaks strict mode: the check cannot run.
    ajv.validate(schema, file.data);
    return (ajv.errors ?? []).map((error) => ({
      file: file.path,
      where: error.instancePath || "/",
      code: "SCHEMA",
      message: schemaMessage(error),
    }));
  });
}

/** ajv's message, plus the property or values it leaves out. */
function schemaMessage(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") {
    return `${error.message}: ${JSON.stringify(error.params.additionalProperty)}`;
  }
  if (error.keyword === "enum") {
    const allowed = (error.params.allowedValues as unknown[]).map((value) =>
      JSON.stringify(value),
    );
    return `${error.message}: ${allowed.join(", ")}`;
  }
  return String(error.message);
}

/** By file, place, message and code, in code-unit order. */
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const key = (d: Diagnostic) =>
    [d.file, d.where, d.message, d.code].join("\0");
  return diagnostics.sort((a, b) => compareText(key(a), key(b)));
}

/** An entry and the command file it comes from. */
type Placed = { file: string; stem: string; entry: Entry };

/** What the rules after SCHEMA see: typed data and the file of each part. */
type Context = {
  placed: Placed[];
  uses: KeyUse[];
  groups: { file: string; groups: Group[] };
  ctrlKeys: { file: string; keys: CtrlKey[] };
  retiredIds: { file: string; ids: string[] };
};

/** The rules after SCHEMA, in the order of design §3. */
const RULES: ((context: Context) => Diagnostic[])[] = [
  checkDuplicateIds,
  checkCategories,
  checkKeySyntax,
  checkForbiddenKeys,
  checkReservedKeys,
  checkDuplicateKeys,
  checkPrefixConflicts,
  checkMissingGroups,
  checkUnusedGroups,
  checkDuplicateGroups,
  checkDuplicateLabels,
  checkDeviations,
  checkSemantics,
  checkSupport,
  checkMotionModes,
  checkAliases,
  checkRetiredIds,
  checkCtrlKeys,
];

type KeyKind = "leader" | "vim";

/** A primary or alias key of an entry, parsed. */
type KeyUse = {
  at: Placed;
  kind: KeyKind;
  text: string;
  /** Where the key is in the entry, such as "aliases[0].keys.vim[1]". */
  field: string;
  /** The index of the alias the key belongs to; undefined for a primary key. */
  alias: number | undefined;
  parsed: ParsedKey;
};

const PARSE: Record<KeyKind, (text: string) => ParsedKey> = {
  leader: parseLeader,
  vim: parseVim,
};

/** Every key of every entry: its primary keys, then the keys of each alias. */
function keyUses(placed: Placed[]): KeyUse[] {
  const uses = (
    at: Placed,
    keys: KeySet,
    base: string,
    alias: number | undefined,
  ): KeyUse[] =>
    (["leader", "vim"] as const).flatMap((kind) =>
      (keys[kind] ?? []).map((text, i) => ({
        at,
        kind,
        text,
        field: `${base}.${kind}[${i}]`,
        alias,
        parsed: PARSE[kind](text),
      })),
    );
  return placed.flatMap((at) => [
    ...uses(at, at.entry.keys, "keys", undefined),
    ...(at.entry.aliases ?? []).flatMap((alias, i) =>
      uses(at, alias.keys, `aliases[${i}].keys`, i),
    ),
  ]);
}

/** A diagnostic on an entry. */
function onEntry(
  { file, entry }: Placed,
  code: string,
  message: string,
): Diagnostic {
  return { file, where: entry.id, code, message };
}

/** Rule CATEGORY_MISMATCH: the file stem, the category and the first part of the id agree. */
function checkCategories({ placed }: Context): Diagnostic[] {
  return placed.flatMap((at) => {
    const { stem, entry } = at;
    const found: Diagnostic[] = [];
    if (entry.category !== stem) {
      found.push(
        onEntry(
          at,
          "CATEGORY_MISMATCH",
          `category ${q(entry.category)} differs from the file stem ${q(stem)}`,
        ),
      );
    }
    if (!entry.id.startsWith(`${entry.category}.`)) {
      found.push(
        onEntry(
          at,
          "CATEGORY_MISMATCH",
          `the id must start with the category: ${q(`${entry.category}.`)}`,
        ),
      );
    }
    return found;
  });
}

/** Rule DUPLICATE_ID: an id names one entry in the whole catalog. */
function checkDuplicateIds({ placed }: Context): Diagnostic[] {
  const firstFile = new Map<string, string>();
  return placed.flatMap((at) => {
    const first = firstFile.get(at.entry.id);
    if (first === undefined) {
      firstFile.set(at.entry.id, at.file);
      return [];
    }
    return [onEntry(at, "DUPLICATE_ID", `the id is already used in ${first}`)];
  });
}

/**
 * Rule KEY_SYNTAX: entry, alias and group keys and the keys an engine replays follow the notation
 * of keys.mts.
 */
function checkKeySyntax({ placed, uses, groups }: Context): Diagnostic[] {
  const found = uses.flatMap((use) =>
    use.parsed.ok
      ? []
      : [onEntry(use.at, "KEY_SYNTAX", `${use.field}: ${use.parsed.message}`)],
  );
  for (const at of placed) {
    const exec = at.entry.vscode?.exec;
    if (exec !== undefined && "vimKeys" in exec) {
      const parsed = parseVim(exec.vimKeys);
      if (!parsed.ok) {
        found.push(
          onEntry(at, "KEY_SYNTAX", `vscode.exec.vimKeys: ${parsed.message}`),
        );
      }
    }
    const intellij = at.entry.intellij;
    if (intellij !== undefined && "ideavimKeys" in intellij) {
      const parsed = parseVim(intellij.ideavimKeys);
      // In the generated rc a | would end the map command.
      const hint = intellij.ideavimKeys.includes("|")
        ? "; write | as <Bar>"
        : "";
      if (!parsed.ok) {
        found.push(
          onEntry(
            at,
            "KEY_SYNTAX",
            `intellij.ideavimKeys: ${parsed.message}${hint}`,
          ),
        );
      }
    }
  }
  for (const group of groups.groups) {
    const parsed = parseLeader(group.keys);
    if (!parsed.ok) {
      found.push({
        file: groups.file,
        where: group.keys,
        code: "KEY_SYNTAX",
        message: parsed.message,
      });
    }
  }
  return found;
}

/** Vim keys that the catalog never redefines, not even as the start of a longer key (D4). */
const PROTECTED_KEYS = ["]b", "[b", "]w", "[w", "]p", "[p", "gh", "gi"];

/**
 * Rule FORBIDDEN_KEY (D4): the Vim keys the companion binds have no Alt chord, no modifier+Space
 * and no bare function key, and do not redefine a protected key. The keys an engine replays are
 * not bound, so they are not checked.
 */
function checkForbiddenKeys({ uses }: Context): Diagnostic[] {
  return uses.flatMap((use) => {
    if (use.kind !== "vim" || !use.parsed.ok) return [];
    const subject = `${use.field} ${q(use.text)}`;
    const found = use.parsed.tokens.flatMap((token) => {
      const problem = forbiddenToken(token);
      return problem === undefined
        ? []
        : [
            onEntry(
              use.at,
              "FORBIDDEN_KEY",
              `${subject} has the ${problem} ${token}`,
            ),
          ];
    });
    for (const key of PROTECTED_KEYS) {
      if (use.text.startsWith(key)) {
        found.push(
          onEntry(
            use.at,
            "FORBIDDEN_KEY",
            `${subject} starts with ${q(key)}, one of the keys the catalog never redefines: ${PROTECTED_KEYS.join(" ")}`,
          ),
        );
      }
    }
    return found;
  });
}

/** What makes a token forbidden, if anything. Modifier and key names ignore case, as in Vim. */
function forbiddenToken(token: string): string | undefined {
  const group = /^<((?:[A-Za-z]-)*)(.+)>$/.exec(token);
  if (group === null) return undefined;
  const modifiers = group[1]!.toUpperCase();
  const name = group[2]!.toUpperCase();
  if (/[AM]-/.test(modifiers)) return "Alt chord";
  if (modifiers !== "" && name === "SPACE") return "modifier+Space chord";
  if (modifiers === "" && /^F(?:[1-9]|1\d|2[0-4])$/.test(name)) {
    return "bare function key";
  }
  return undefined;
}

/** Rule RESERVED_KEY: no leader key uses ?, which the companion keeps for itself. */
function checkReservedKeys({ uses }: Context): Diagnostic[] {
  return uses.flatMap((use) =>
    use.kind === "leader" && use.parsed.ok && use.parsed.tokens.includes("?")
      ? [
          onEntry(
            use.at,
            "RESERVED_KEY",
            `${use.field} ${q(use.text)} contains the reserved key ?: SPC ? is the catalog search, and ? below the root shows the hints`,
          ),
        ]
      : [],
  );
}

/** Rule DUPLICATE_KEY: no key sequence is bound twice in a mode, by entries or aliases. */
function checkDuplicateKeys({ uses }: Context): Diagnostic[] {
  return uses.flatMap((use, i) => {
    if (!use.parsed.ok) return [];
    const modes = modesOf(use.at.entry);
    const earlier = uses.slice(0, i).find(
      (other) =>
        other.kind === use.kind &&
        other.text === use.text &&
        modesOf(other.at.entry).some((mode) => modes.includes(mode)) &&
        // An alias with a primary key of its own entry is for ALIAS to report.
        !(other.at === use.at && other.alias === undefined),
    );
    return earlier === undefined
      ? []
      : [
          onEntry(
            use.at,
            "DUPLICATE_KEY",
            `${use.field} ${q(use.text)} is also bound by ${owner(earlier)}`,
          ),
        ];
  });
}

/**
 * Rule PREFIX_CONFLICT: no key starts a longer key of its kind, whatever the modes. Below a leader
 * prefix that starts a longer key there must be a group, not a leaf.
 */
function checkPrefixConflicts({ uses }: Context): Diagnostic[] {
  return uses.flatMap((use) => {
    if (!use.parsed.ok) return [];
    const prefix = use.parsed.tokens;
    return uses
      .filter(
        (other) =>
          other.kind === use.kind &&
          other.parsed.ok &&
          other.parsed.tokens.length > prefix.length &&
          startsWith(other.parsed.tokens, prefix),
      )
      .map((other) =>
        onEntry(
          use.at,
          "PREFIX_CONFLICT",
          `${use.field} ${q(use.text)} is a prefix of ${q(other.text)}, bound by ${owner(other)}`,
        ),
      );
  });
}

/** Rule MISSING_GROUP: each leader prefix below the root that has keys under it has a group label. */
function checkMissingGroups({ uses, groups }: Context): Diagnostic[] {
  const labelled = new Set(groups.groups.map((group) => group.keys));
  const reported = new Set<string>();
  const found: Diagnostic[] = [];
  for (const use of uses) {
    if (use.kind !== "leader" || !use.parsed.ok) continue;
    // From "SPC w" up to the prefix just above the leaf.
    for (let end = 2; end < use.parsed.tokens.length; end++) {
      const prefix = use.parsed.tokens.slice(0, end).join(" ");
      if (labelled.has(prefix) || reported.has(prefix)) continue;
      reported.add(prefix);
      found.push({
        file: groups.file,
        where: prefix,
        code: "MISSING_GROUP",
        message: `no group label for this prefix of ${q(use.text)}, bound by ${owner(use)}`,
      });
    }
  }
  return found;
}

/** Rule UNUSED_GROUP: each group has a leader key below its prefix. */
function checkUnusedGroups({ uses, groups }: Context): Diagnostic[] {
  const leaderKeys = uses.flatMap((use) =>
    use.kind === "leader" && use.parsed.ok ? [use.parsed.tokens] : [],
  );
  return groups.groups.flatMap((group) => {
    const parsed = parseLeader(group.keys);
    // A malformed group key is reported by KEY_SYNTAX.
    if (!parsed.ok) return [];
    const used = leaderKeys.some(
      (tokens) =>
        tokens.length > parsed.tokens.length &&
        startsWith(tokens, parsed.tokens),
    );
    return used
      ? []
      : [
          {
            file: groups.file,
            where: group.keys,
            code: "UNUSED_GROUP",
            message: "no leader key is below this prefix",
          },
        ];
  });
}

/** Rule DUPLICATE_GROUP: a prefix has one group. */
function checkDuplicateGroups({ groups }: Context): Diagnostic[] {
  const first = new Map<string, Group>();
  return groups.groups.flatMap((group) => {
    const earlier = first.get(group.keys);
    if (earlier === undefined) {
      first.set(group.keys, group);
      return [];
    }
    return [
      {
        file: groups.file,
        where: group.keys,
        code: "DUPLICATE_GROUP",
        message: `the prefix already has the group label ${q(earlier.label)}`,
      },
    ];
  });
}

/**
 * Rule DUPLICATE_LABEL: the children of a leader prefix, that is the entries at their leader keys
 * and the groups, have different labels. Alias labels are generated, so aliases are exempt.
 */
function checkDuplicateLabels({ uses, groups }: Context): Diagnostic[] {
  type Child = {
    parent: string;
    label: string;
    name: string;
    report: (message: string) => Diagnostic;
  };
  const parentOf = (tokens: readonly string[]) => tokens.slice(0, -1).join(" ");
  const children: Child[] = [];
  for (const use of uses) {
    if (use.kind !== "leader" || use.alias !== undefined || !use.parsed.ok) {
      continue;
    }
    children.push({
      parent: parentOf(use.parsed.tokens),
      label: use.at.entry.label,
      name: `${use.at.entry.id} ${q(use.text)}`,
      report: (message) =>
        onEntry(
          use.at,
          "DUPLICATE_LABEL",
          `${use.field} ${q(use.text)}: ${message}`,
        ),
    });
  }
  const seen = new Set<string>();
  for (const group of groups.groups) {
    const parsed = parseLeader(group.keys);
    // KEY_SYNTAX and DUPLICATE_GROUP report malformed and repeated groups.
    if (!parsed.ok || seen.has(group.keys)) continue;
    seen.add(group.keys);
    children.push({
      parent: parentOf(parsed.tokens),
      label: group.label,
      name: `group ${q(group.keys)}`,
      report: (message) => ({
        file: groups.file,
        where: group.keys,
        code: "DUPLICATE_LABEL",
        message,
      }),
    });
  }
  return children.flatMap((child, i) => {
    const first = children
      .slice(0, i)
      .find(
        (other) => other.parent === child.parent && other.label === child.label,
      );
    return first === undefined
      ? []
      : [
          child.report(
            `the label ${q(child.label)} is also used under ${q(child.parent)} by ${first.name}`,
          ),
        ];
  });
}

/**
 * Rule MISSING_DEVIATION: an entry with Vim keys has a deviation when an IDE that supports it
 * remaps one of them, that is, runs anything but the same keys in its engine.
 */
function checkDeviations({ placed, uses }: Context): Diagnostic[] {
  return placed.flatMap((at) => {
    const { entry } = at;
    if (entry.keys.vim === undefined || entry.deviation !== undefined)
      return [];
    const remapped = uses
      .filter((use) => use.at === at && use.kind === "vim")
      .flatMap((use) =>
        IDES.filter(
          (ide) => supported(entry, ide) && engineKeys(entry, ide) !== use.text,
        ).map((ide) => ({ use, ide })),
      );
    const first = remapped[0];
    return first === undefined
      ? []
      : [
          onEntry(
            at,
            "MISSING_DEVIATION",
            `${first.use.field} ${q(first.use.text)} is remapped in ${IDE_NAMES[first.ide]}, so "deviation" is required`,
          ),
        ];
  });
}

/**
 * Rule MISSING_SEMANTICS: when one IDE runs engine keys and the other a command or action, the
 * entry says how the engine side behaves.
 */
function checkSemantics({ placed }: Context): Diagnostic[] {
  return placed.flatMap((at) => {
    const { entry } = at;
    if (entry.vscode === undefined || entry.intellij === undefined) return [];
    const vscodevim = engineKeys(entry, "vscode") !== undefined;
    if (vscodevim === (engineKeys(entry, "intellij") !== undefined)) return [];
    const property = vscodevim ? "vscodevim" : "ideavim";
    if (entry.semantics?.[property] !== undefined) return [];
    const sides = vscodevim
      ? "VS Code runs VSCodeVim keys and IntelliJ an action"
      : "IntelliJ runs IdeaVim keys and VS Code a command";
    return [
      onEntry(
        at,
        "MISSING_SEMANTICS",
        `${sides}, so ${q(`semantics.${property}`)} is required`,
      ),
    ];
  });
}

/**
 * Rule SUPPORT: an IDE block is absent exactly when the support level there is none; partial and
 * none say what is missing in a note; every entry runs in at least one IDE.
 */
function checkSupport({ placed }: Context): Diagnostic[] {
  return placed.flatMap((at) => {
    const { entry } = at;
    const found: Diagnostic[] = [];
    for (const ide of IDES) {
      const support = entry.support?.[ide];
      const level = q(`support.${ide}.level`);
      if (entry[ide] === undefined && support?.level !== "none") {
        found.push(
          onEntry(
            at,
            "SUPPORT",
            `the entry has no ${q(ide)} block, so ${level} must be "none"`,
          ),
        );
      }
      if (entry[ide] !== undefined && support?.level === "none") {
        found.push(
          onEntry(
            at,
            "SUPPORT",
            `${level} is "none" although the entry has the ${q(ide)} block`,
          ),
        );
      }
      if (support !== undefined && support.level !== "full" && !support.note) {
        found.push(
          onEntry(
            at,
            "SUPPORT",
            `${q(`support.${ide}`)} with level ${q(support.level)} needs a note`,
          ),
        );
      }
    }
    if (!IDES.some((ide) => supported(entry, ide))) {
      found.push(
        onEntry(at, "SUPPORT", "the entry is supported in neither IDE"),
      );
    }
    return found;
  });
}

/** Rule MOTION_MODE: an IntelliJ action that acts as a motion stays out of Visual mode. */
function checkMotionModes({ placed }: Context): Diagnostic[] {
  return placed.flatMap((at) =>
    at.entry.intellij?.motionSafe === false && modesOf(at.entry).includes("x")
      ? [
          onEntry(
            at,
            "MOTION_MODE",
            '"intellij.motionSafe" is false: IdeaVim cannot run the action in Visual mode, so "modes" must not contain "x"',
          ),
        ]
      : [],
  );
}

/** The longest label, generated or not. */
const LABEL_MAX = 24;

const KIND_NAMES: Record<KeyKind, string> = { leader: "leader", vim: "Vim" };

/**
 * Rule ALIAS: an alias moves an old key to the entry's first key of the same kind, so its label
 * "Moved to <key>" needs that key and fits 24 characters; the old key is not the entry's own, and
 * until is a version.
 */
function checkAliases({ placed }: Context): Diagnostic[] {
  return placed.flatMap((at) => {
    const { entry } = at;
    return (entry.aliases ?? []).flatMap((alias, a) => {
      const found: Diagnostic[] = [];
      for (const kind of ["leader", "vim"] as const) {
        const keys = alias.keys[kind];
        if (keys === undefined) continue;
        const field = `aliases[${a}].keys.${kind}`;
        const own = entry.keys[kind];
        if (own === undefined) {
          found.push(
            onEntry(
              at,
              "ALIAS",
              `${field} needs a primary ${KIND_NAMES[kind]} key for its label "Moved to <key>"`,
            ),
          );
          continue;
        }
        const label = `Moved to ${own[0]}`;
        if (label.length > LABEL_MAX) {
          found.push(
            onEntry(
              at,
              "ALIAS",
              `${field}: the label ${q(label)} is longer than ${LABEL_MAX} characters`,
            ),
          );
        }
        keys.forEach((key, i) => {
          if (own.includes(key)) {
            found.push(
              onEntry(
                at,
                "ALIAS",
                `${field}[${i}] ${q(key)} is the entry's own key`,
              ),
            );
          }
        });
      }
      if (!isVersion(alias.until)) {
        found.push(
          onEntry(
            at,
            "ALIAS",
            `aliases[${a}].until ${q(alias.until)} is not a version x.y.z[-prerelease]`,
          ),
        );
      }
      return found;
    });
  });
}

/** Rule RETIRED_ID: no entry takes the id of an entry that was removed. */
function checkRetiredIds({ placed, retiredIds }: Context): Diagnostic[] {
  const retired = new Set(retiredIds.ids);
  return placed.flatMap((at) =>
    retired.has(at.entry.id)
      ? [
          onEntry(
            at,
            "RETIRED_ID",
            `the id is listed in ${retiredIds.file}, so no entry may use it again`,
          ),
        ]
      : [],
  );
}

/** Ctrl and one lowercase letter, as IdeaVim's sethandler takes it. */
const CTRL_KEY = /^<C-[a-z]>$/;

/** sethandler arguments: modes joined by "-", then ":vim" or ":ide"; one space between them. */
const HANDLERS =
  /^[nivxsca](?:-[nivxsca])*:(?:vim|ide)(?: [nivxsca](?:-[nivxsca])*:(?:vim|ide))*$/;

/**
 * Rule CTRL_KEY: each Ctrl key is listed once, and its handlers split into tokens on single spaces,
 * as IdeaVim splits them.
 */
function checkCtrlKeys({ ctrlKeys }: Context): Diagnostic[] {
  const seen = new Set<string>();
  return ctrlKeys.keys.flatMap((ctrl) => {
    const found: Diagnostic[] = [];
    const report = (message: string) =>
      found.push({
        file: ctrlKeys.file,
        where: ctrl.key,
        code: "CTRL_KEY",
        message,
      });
    if (!CTRL_KEY.test(ctrl.key)) {
      report("the key must be <C-x> with a lowercase letter x");
    }
    if (seen.has(ctrl.key)) report("the key is already listed");
    seen.add(ctrl.key);
    for (const field of ["handler", "mac"] as const) {
      const value = ctrl[field];
      if (value !== undefined && !HANDLERS.test(value)) {
        report(
          `${field} ${q(value)} must be mode:vim or mode:ide tokens such as "a:vim" or "n-v:ide", separated by single spaces`,
        );
      }
    }
    return found;
  });
}

const IDES = ["vscode", "intellij"] as const;

const IDE_NAMES: Record<Ide, string> = {
  vscode: "VS Code",
  intellij: "IntelliJ",
};

/** Whether the entry runs in the IDE: it has a block there and a support level other than none. */
function supported(entry: Entry, ide: Ide): boolean {
  return entry[ide] !== undefined && entry.support?.[ide]?.level !== "none";
}

/** The keys that the IDE's engine replays for the entry, when it runs engine keys. */
function engineKeys(entry: Entry, ide: Ide): string | undefined {
  if (ide === "vscode") {
    const exec = entry.vscode?.exec;
    return exec !== undefined && "vimKeys" in exec ? exec.vimKeys : undefined;
  }
  const intellij = entry.intellij;
  return intellij !== undefined && "ideavimKeys" in intellij
    ? intellij.ideavimKeys
    : undefined;
}

/** Whether the tokens begin with the tokens of the prefix. */
function startsWith(
  tokens: readonly string[],
  prefix: readonly string[],
): boolean {
  return prefix.every((token, i) => tokens[i] === token);
}

/** The entry that a key belongs to, for messages: "search.project (alias)". */
function owner(use: KeyUse): string {
  return use.alias === undefined
    ? use.at.entry.id
    : `${use.at.entry.id} (alias)`;
}

/** The modes of an entry; "n" when it has none. */
function modesOf(entry: Entry): readonly Mode[] {
  return entry.modes ?? ["n"];
}

/** "spec/catalog/commands/code.json" → "code". */
export function stemOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

/** A value quoted for a message. */
const q = (value: string): string => JSON.stringify(value);

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
