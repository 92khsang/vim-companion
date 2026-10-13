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
  KeySet,
  Mode,
} from "./catalog.mts";
import { parseLeader, parseVim, type ParsedKey } from "./keys.mts";

/** A parsed catalog file; `path` is repo-relative and POSIX, for messages. */
export type CatalogFile = { path: string; data: unknown };

export type CatalogFiles = {
  commands: readonly CatalogFile[];
  groups: CatalogFile;
  ctrlKeys: CatalogFile;
  retiredIds: CatalogFile;
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

/** Rule SCHEMA: ajv 2020 in strict mode, every error of every file. */
function checkSchemas(
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
    const earlier = uses
      .slice(0, i)
      .find(
        (other) =>
          other.kind === use.kind &&
          other.text === use.text &&
          modesOf(other.at.entry).some((mode) => modes.includes(mode)),
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
function stemOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

/** A value quoted for a message. */
const q = (value: string): string => JSON.stringify(value);

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
