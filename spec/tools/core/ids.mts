// The ID check (design §8): the commands and actions that the catalog and the generated files name
// must exist in the ID snapshots of spec/ids.
import type { Diagnostic, Entry } from "./catalog.mts";

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
  const vscode = snapshots.vscode;
  const known = new Set(vscode.data.commands);
  return commands.flatMap(({ path, data }) =>
    data.commands.flatMap((entry) => {
      const exec = entry.vscode?.exec;
      if (exec === undefined || !("command" in exec)) return [];
      if (known.has(exec.command)) return [];
      return [
        {
          file: path,
          where: entry.id,
          code: "UNKNOWN_COMMAND",
          message: `vscode.exec.command ${q(exec.command)} is not in ${vscode.path}${didYouMean(suggest(exec.command, known))}`,
        },
      ];
    }),
  );
}

/** " (did you mean "a", "b" or "c"?)". */
function didYouMean(ids: readonly string[]): string {
  const quoted = ids.map(q);
  return ` (did you mean ${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}?)`;
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
