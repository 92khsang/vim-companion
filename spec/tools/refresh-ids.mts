// pnpm ids:refresh vscode|intellij (design §8): rewrites ids/<ide>.json of the spec directory from
// the IDE installed on this machine, and prints what it wrote. Exits 2 when it cannot run.
//   vscode   [--code <binary>] [--extension <publisher.name>]... [--drop-extension <publisher.name>]...
//   intellij [--ide-home <dir>] [--plugins-dir <dir>] [--plugin <dir or .jar>]... [--drop-plugin <name>]...
// The allow-listed plugins are the ones of the snapshot it replaces, plus --plugin, minus
// --drop-plugin.
// --root <dir>: the spec directory to write to; by default the one this file is in.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { readSchemas, repoPath } from "./catalog-files.mts";
import {
  parseDescriptorIds,
  pluginVersion,
  runtimeIntellijIds,
  type IntellijIds,
  type VscodeIds,
} from "./core/ids.mts";
import { checkSchemas } from "./core/validate.mts";

type Ide = "vscode" | "intellij";

const OPTIONS = {
  root: { type: "string" },
  code: { type: "string" },
  extension: { type: "string", multiple: true },
  "drop-extension": { type: "string", multiple: true },
  "ide-home": { type: "string" },
  "plugins-dir": { type: "string" },
  plugin: { type: "string", multiple: true },
  "drop-plugin": { type: "string", multiple: true },
} as const;

/** The IDE that each option other than --root belongs to. */
const OWNER: Record<string, Ide> = {
  code: "vscode",
  extension: "vscode",
  "drop-extension": "vscode",
  "ide-home": "intellij",
  "plugins-dir": "intellij",
  plugin: "intellij",
  "drop-plugin": "intellij",
};

type Values = ReturnType<typeof parseOptions>["values"];

function parseOptions() {
  return parseArgs({ options: OPTIONS, allowPositionals: true });
}

function main(): void {
  const { values, positionals } = parseOptions();
  const [ide, ...rest] = positionals;
  if ((ide !== "vscode" && ide !== "intellij") || rest.length > 0) {
    throw new Error("name the IDE to refresh: vscode or intellij");
  }
  for (const name of Object.keys(values)) {
    const owner = OWNER[name];
    if (owner !== undefined && owner !== ide) {
      throw new Error(`--${name} is an option of ${owner}, not ${ide}`);
    }
  }
  const root = resolve(values.root ?? join(import.meta.dirname, ".."));
  if (ide === "vscode") refreshVscode(values);
  else refreshIntellij(root, values);
}

function refreshVscode(values: Values): void {
  const code = resolve(values.code ?? "/usr/share/code/code");
  readJson(join(dirname(code), "resources/app/package.json"));
}

function refreshIntellij(root: string, values: Values): void {
  const ideHome = resolve(
    values["ide-home"] ??
      join(
        homedir(),
        ".local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate",
      ),
  );
  const product = readJson(join(ideHome, "product-info.json")) as Record<
    string,
    string
  >;
  const pluginsDir = resolve(
    values["plugins-dir"] ??
      join(
        homedir(),
        ".local/share/JetBrains",
        `${product["dataDirectoryName"]}`,
      ),
  );
  const previous = previousSnapshot(root, "intellij") as
    IntellijIds | undefined;
  const dropped = new Set(values["drop-plugin"]);
  const names = [
    ...new Set([
      ...Object.keys(previous?.plugins ?? {}),
      ...(values.plugin ?? []),
    ]),
  ]
    .filter((name) => !dropped.has(name))
    .sort();
  const plugins = names.map((name) => {
    const path = join(pluginsDir, name);
    if (!existsSync(path))
      throw new Error(`no plugin ${name} in ${pluginsDir}`);
    // A plugin is a directory of jars or a single jar.
    const jars = statSync(path).isDirectory() ? jarsIn(path) : [path];
    const version = jars
      .map((jar) => pluginVersion(unzip(jar, ["META-INF/plugin.xml"])))
      .find((found) => found !== undefined);
    if (version === undefined) {
      throw new Error(`no META-INF/plugin.xml with a <version> in ${path}`);
    }
    return { name, version, jars };
  });
  // Descriptors are the XML files at the root and in META-INF of each jar; the bundled Java
  // runtime is not part of the IDE.
  const jars = [
    ...jarsIn(ideHome).filter(
      (jar) => !jar.startsWith(join(ideHome, "jbr") + sep),
    ),
    ...plugins.flatMap((plugin) => plugin.jars),
  ];
  const { ids, toolWindows } = parseDescriptorIds(
    jars.map((jar) => unzip(jar, ["*.xml", "META-INF/*.xml"])).join("\n"),
  );
  const snapshot: IntellijIds = {
    ide: `${product["productCode"]}-${product["buildNumber"]}`,
    plugins: Object.fromEntries(
      plugins.map(({ name, version }) => [name, version]),
    ),
    declared: ids,
    runtime: runtimeIntellijIds(toolWindows, ids),
  };
  const file = writeSnapshot(root, "intellij", snapshot);
  const from = [
    snapshot.ide,
    ...plugins.map(({ name, version }) => `${name} ${version}`),
  ].join(", ");
  console.log(
    `ids:refresh: wrote ${file}: ${snapshot.declared.length} declared and ${snapshot.runtime.length} runtime IDs from ${from}`,
  );
}

/** The snapshot that a refresh replaces, if there is one. */
function previousSnapshot(root: string, ide: Ide): unknown {
  const path = join(root, "ids", `${ide}.json`);
  return existsSync(path) ? readJson(path) : undefined;
}

/** Writes the snapshot when it passes schema/ids.schema.json; returns its repo path. */
function writeSnapshot(root: string, ide: Ide, snapshot: object): string {
  const path = join(root, "ids", `${ide}.json`);
  const file = repoPath(root, path);
  const problems = checkSchemas(
    [
      {
        file: { path: file, data: snapshot },
        schema: `ids.schema.json#/$defs/${ide}`,
      },
    ],
    readSchemas(root),
  );
  if (problems.length > 0) {
    throw new Error(
      problems
        .map(({ where, message }) => `${file}: ${where}: ${message}`)
        .join("\n"),
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return file;
}

/** The jars below a directory, in code-unit order of their paths. */
function jarsIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".jar"))
    .map((path) => join(dir, path))
    .filter((path) => statSync(path).isFile())
    .sort();
}

/** The concatenated text of the jar entries that match the patterns; "" when none does. */
function unzip(jar: string, patterns: string[]): string {
  // -W: "*" does not match "/", so "*.xml" is only the jar root.
  const { status, stdout, stderr, error } = spawnSync(
    "unzip",
    ["-W", "-p", jar, ...patterns],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (error !== undefined) throw new Error(`unzip: ${error.message}`);
  // 11: a pattern matches no entry; the entries that the other patterns match are still there.
  if (status !== 0 && status !== 11) {
    throw new Error(`unzip ${jar} exited with ${status}: ${stderr.trim()}`);
  }
  return stdout;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

try {
  main();
} catch (error) {
  console.error(`ids:refresh: ${(error as Error).message}`);
  process.exitCode = 2;
}
