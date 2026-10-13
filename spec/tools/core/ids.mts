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
  const generated = generatedCommandIds
    .filter((id) => !known.vscode.has(id))
    .map((id) => ({
      file: snapshots.vscode.path,
      where: id,
      code: UNKNOWN.vscode,
      message: `pnpm gen writes this command, but the snapshot lacks it${didYouMean(suggest(id, known.vscode))}`,
    }));
  return sortDiagnostics([...found, ...generated]);
}

/**
 * "check-ids: resolved 4/6 VS Code commands and 3/4 IntelliJ actions; unsupported entries: VS Code 1,
 * IntelliJ 1": how many of the IDs that checkIds checked it found, given its diagnostics, and how
 * many entries have no block for an IDE.
 */
export function idSummary(
  commands: readonly CommandFile[],
  generatedCommandIds: readonly string[],
  diagnostics: readonly Diagnostic[],
): string {
  const entries = commands.flatMap(({ data }) => data.commands);
  const ids = entries.flatMap(idsOf);
  const checked = (ide: Ide) =>
    ids.filter((id) => id.ide === ide).length +
    (ide === "vscode" ? generatedCommandIds.length : 0);
  const resolved = (ide: Ide) =>
    `${checked(ide) - diagnostics.filter(({ code }) => code === UNKNOWN[ide]).length}/${checked(ide)}`;
  const unsupported = (ide: Ide) =>
    entries.filter((entry) => entry[ide] === undefined).length;
  return `check-ids: resolved ${resolved("vscode")} VS Code commands and ${resolved("intellij")} IntelliJ actions; unsupported entries: VS Code ${unsupported("vscode")}, IntelliJ ${unsupported("intellij")}`;
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

/** " (did you mean "a", "b" or "c"?)", " (did you mean "a"?)", or "" without suggestions. */
function didYouMean(ids: readonly string[]): string {
  const quoted = ids.map(q);
  const last = quoted.pop();
  if (last === undefined) return "";
  const list = quoted.length > 0 ? `${quoted.join(", ")} or ${last}` : last;
  return ` (did you mean ${list}?)`;
}

/** By file, place, message and code, in code-unit order. */
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const key = (d: Diagnostic) =>
    [d.file, d.where, d.message, d.code].join("\0");
  return diagnostics.sort((a, b) => compareText(key(a), key(b)));
}

/** A value quoted for a message. */
const q = (value: string): string => JSON.stringify(value);

/** The IDs that IntelliJ plugin descriptors declare, from the text of one or more descriptors. */
export type DescriptorIds = {
  /** The IDs of <action> and <group> elements. */
  ids: string[];
  /** The IDs of <toolWindow> elements, which name runtime actions. */
  toolWindows: string[];
};

/** The action, group and tool window IDs of plugin descriptor XML, sorted and without repeats. */
export function parseDescriptorIds(xml: string): DescriptorIds {
  // An ID that only a comment mentions is not declared.
  const text = withoutComments(xml);
  const collect = (pattern: RegExp) =>
    [...new Set(Array.from(text.matchAll(pattern), (m) => m[1]!))].sort();
  return {
    ids: collect(/<(?:action|group)\b[^>]*?\bid\s*=\s*"([^"]+)"/g),
    toolWindows: collect(/<toolWindow\b[^>]*?\bid\s*=\s*"([^"]+)"/g),
  };
}

/**
 * The action IDs that IntelliJ registers at runtime and that `declared` lacks: one
 * Activate<id>ToolWindow per tool window, and the Run and Debug executor actions.
 */
export function runtimeIntellijIds(
  toolWindows: readonly string[],
  declared: readonly string[],
): string[] {
  const known = new Set(declared);
  const derived = [
    // ActivateToolWindowAction.getActionIdForToolWindow: Kotlin's replace drops every space.
    ...toolWindows.map((id) => `Activate${id.replaceAll(" ", "")}ToolWindow`),
    // The DefaultRunExecutor and DefaultDebugExecutor actions and their context actions.
    ...["Run", "RunClass", "Debug", "DebugClass"],
  ];
  return [...new Set(derived)].filter((id) => !known.has(id)).sort();
}

/**
 * The command IDs of a VS Code dump (`commands.getCommands(true)`) together with the commands that
 * extension manifests (package.json) contribute or bind keys to, sorted and without repeats.
 */
export function mergeVscodeCommands(
  dumped: readonly string[],
  manifests: readonly unknown[],
): string[] {
  const ids = [...dumped, ...manifests.flatMap(contributedCommands)]
    // A key binding "-id" removes a binding of the command "id".
    .map((id) => id.replace(/^-/, ""))
    // getCommands(true) leaves out the internal "_" commands, so the manifests' ones go too.
    .filter((id) => !id.startsWith("_"));
  return [...new Set(ids)].sort();
}

/** The commands of `contributes.commands` and `contributes.keybindings`: an object or an array. */
function contributedCommands(manifest: unknown): string[] {
  const contributes = (manifest as { contributes?: Record<string, unknown> })
    .contributes;
  return [contributes?.["commands"], contributes?.["keybindings"]]
    .flat()
    .flatMap((item) => {
      const command = (item as { command?: unknown } | undefined)?.command;
      return typeof command === "string" ? [command] : [];
    });
}

/** An installed VS Code extension: "publisher.name" as its manifest writes it. */
export type Extension = { id: string; version: string; dir: string };

/**
 * The highest installed version of each wanted extension, matching IDs case-insensitively as VS
 * Code does, in code-unit order of their IDs; `missing` lists the wanted IDs that none matches.
 */
export function pickExtensions(
  installed: readonly { dir: string; manifest: unknown }[],
  wanted: readonly string[],
): { picked: Extension[]; missing: string[] } {
  const extensions = installed.flatMap(({ dir, manifest }): Extension[] => {
    const { publisher, name, version } = manifest as Record<string, unknown>;
    return typeof publisher === "string" &&
      typeof name === "string" &&
      typeof version === "string"
      ? [{ id: `${publisher}.${name}`, version, dir }]
      : [];
  });
  const picked = new Map<string, Extension>();
  const missing: string[] = [];
  for (const id of wanted) {
    const key = id.toLowerCase();
    const newest = extensions
      .filter((extension) => extension.id.toLowerCase() === key)
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    if (newest === undefined) missing.push(id);
    else picked.set(key, newest);
  }
  return {
    picked: [...picked.values()].sort((a, b) => compareText(a.id, b.id)),
    missing,
  };
}

/** By the numbers of "major.minor.patch"; then, as in SemVer, a prerelease before its release. */
function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((version) =>
    version.split(/[.-]/, 3).map(Number),
  ) as [number[], number[]];
  const release = (version: string) => Number(!version.includes("-"));
  return (
    x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]! || release(a) - release(b)
  );
}

/** The <version> of an IntelliJ plugin descriptor (META-INF/plugin.xml), outside comments. */
export function pluginVersion(pluginXml: string): string | undefined {
  const text = withoutComments(pluginXml);
  return /<version>\s*([^<]*?)\s*<\/version>/.exec(text)?.[1];
}

/** XML without its <!-- --> comments. */
function withoutComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

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
