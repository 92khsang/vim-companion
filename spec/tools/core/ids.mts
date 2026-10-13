// The ID check (design §8): the commands and actions that the catalog and the generated files name
// must exist in the ID snapshots of spec/ids.
import type { Diagnostic, Entry, Ide } from "./catalog.mts";

/** spec/ids/vscode.json: the command IDs of a VS Code version and its allow-listed extensions. */
export type VscodeIds = {
  vscode: string;
  /** "publisher.name" → version. */
  extensions: Record<string, string>;
  commands: string[];
};

/** spec/ids/intellij.json: the action IDs of an IntelliJ build and its allow-listed plugins. */
export type IntellijIds = {
  /** "<productCode>-<buildNumber>", such as "IU-262.10968.63". */
  ide: string;
  /** Plugin directory or jar name → version. */
  plugins: Record<string, string>;
  /** The action and group IDs that the plugin descriptors declare. */
  declared: string[];
  /** The IDs that the IDE registers at runtime and no descriptor declares. */
  runtime: string[];
};

/** A snapshot and its repo-relative POSIX path, for messages. */
export type IdSnapshot<T> = { path: string; data: T };

export type IdSnapshots = {
  vscode: IdSnapshot<VscodeIds>;
  intellij: IdSnapshot<IntellijIds>;
};

/** A command file that passed spec:check: its repo-relative POSIX path and its entries. */
export type CommandFile = {
  path: string;
  data: { commands: readonly Entry[] };
};

/**
 * Every VS Code command and IntelliJ action of the entries, and every command that pnpm gen
 * writes, that the snapshots lack. Engine keys (vimKeys, ideavimKeys) are not IDs.
 */
export function checkIds(
  commands: readonly CommandFile[],
  snapshots: IdSnapshots,
  generatedCommandIds: readonly string[],
): Diagnostic[] {
  const known: Record<Ide, Set<string>> = {
    vscode: new Set(snapshots.vscode.data.commands),
    intellij: new Set([
      ...snapshots.intellij.data.declared,
      ...snapshots.intellij.data.runtime,
    ]),
  };
  const found = commands.flatMap(({ path, data }) =>
    data.commands.flatMap((entry) =>
      idsOf(entry)
        .filter(({ ide, id }) => !known[ide].has(id))
        .map(({ ide, field, id }) => ({
          file: path,
          where: entry.id,
          code: UNKNOWN[ide],
          message: `${field} ${q(id)} is not in ${snapshots[ide].path}${didYouMean(suggest(id, known[ide]))}`,
        })),
    ),
  );
  return sortDiagnostics(found);
}

const UNKNOWN: Record<Ide, string> = {
  vscode: "UNKNOWN_COMMAND",
  intellij: "UNKNOWN_ACTION",
};

/** The IDs that an entry names: its VS Code command and its IntelliJ action. */
function idsOf(entry: Entry): { ide: Ide; field: string; id: string }[] {
  const ids: { ide: Ide; field: string; id: string }[] = [];
  const exec = entry.vscode?.exec;
  if (exec !== undefined && "command" in exec) {
    ids.push({ ide: "vscode", field: "vscode.exec.command", id: exec.command });
  }
  const intellij = entry.intellij;
  if (intellij !== undefined && "action" in intellij) {
    ids.push({
      ide: "intellij",
      field: "intellij.action",
      id: intellij.action,
    });
  }
  return ids;
}

/** " (did you mean "a", "b" or "c"?)". */
function didYouMean(ids: readonly string[]): string {
  const quoted = ids.map(q);
  return ` (did you mean ${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}?)`;
}

/** By file, place, message and code, in code-unit order. */
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const key = (d: Diagnostic) =>
    [d.file, d.where, d.message, d.code].join("\0");
  return diagnostics.sort((a, b) => compareText(key(a), key(b)));
}

/** A value quoted for a message. */
const q = (value: string): string => JSON.stringify(value);

/** The three known IDs nearest to `id` by edit distance; ties in code-unit order. */
export function suggest(id: string, known: Iterable<string>): string[] {
  return [...known]
    .map((candidate) => ({ candidate, distance: editDistance(id, candidate) }))
    .sort(
      (a, b) =>
        a.distance - b.distance || compareText(a.candidate, b.candidate),
    )
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

/** The Levenshtein distance: the fewest insertions, deletions and substitutions from a to b. */
function editDistance(a: string, b: string): number {
  // previous[j] is the distance from the first i - 1 characters of a to the first j of b.
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + Number(a[i - 1] !== b[j - 1]);
      current.push(
        Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
