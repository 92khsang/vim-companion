// pnpm ids:refresh vscode|intellij (design §8): rewrites ids/<ide>.json of the spec directory from
// the IDE installed on this machine, and prints what it wrote. Exits 2 when it cannot run.
//   vscode   [--code <binary>] [--extension <publisher.name>]... [--drop-extension <publisher.name>]...
//   intellij [--ide-home <dir>] [--plugins-dir <dir>] [--plugin <dir or .jar>]... [--drop-plugin <name>]...
// The allow-listed extensions or plugins are the ones of the snapshot it replaces, plus
// --extension or --plugin, minus --drop-extension or --drop-plugin.
// VS Code runs under xvfb-run with the dump extension in tools/ids/vscode-dump, in temporary
// directories with copies of the allow-listed extensions: it never sees the user's own.
// --root <dir>: the spec directory to write to; by default the one this file is in.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { readSchemas, repoPath } from "./catalog-files.mts";
import {
  mergeVscodeCommands,
  parseDescriptorIds,
  pickExtensions,
  pluginVersion,
  runtimeIntellijIds,
  type Extension,
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

async function main(): Promise<void> {
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
  if (ide === "vscode") await refreshVscode(root, values);
  else refreshIntellij(root, values);
}

async function refreshVscode(root: string, values: Values): Promise<void> {
  const code = resolve(values.code ?? "/usr/share/code/code");
  const app = join(dirname(code), "resources/app");
  const { version } = readJson(join(app, "package.json")) as {
    version: string;
  };
  const previous = previousSnapshot(root, "vscode") as VscodeIds | undefined;
  const dropped = new Set(
    (values["drop-extension"] ?? []).map((id) => id.toLowerCase()),
  );
  const wanted = [
    ...Object.keys(previous?.extensions ?? {}),
    ...(values.extension ?? []),
  ].filter((id) => !dropped.has(id.toLowerCase()));
  const source = join(homedir(), ".vscode/extensions");
  const installed = manifestsIn(source);
  const { picked, missing } = pickExtensions(installed, wanted);
  if (missing.length > 0) {
    throw new Error(`${source} has no ${missing.join(", ")}`);
  }
  const temp = mkdtempSync(join(tmpdir(), "vim-companion-ids-"));
  let dump: Dump;
  try {
    dump = await dumpCommands(code, temp, picked);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  // Commands of extensions that did not activate are missing from the dump, so the declared
  // ones of every built-in and allow-listed extension join them.
  const manifests = [
    ...manifestsIn(join(app, "extensions")),
    ...installed.filter(({ dir }) => picked.some((pick) => pick.dir === dir)),
  ].map(({ manifest }) => manifest);
  const snapshot: VscodeIds = {
    vscode: version,
    extensions: Object.fromEntries(
      picked.map(({ id, version }) => [id, version]),
    ),
    commands: mergeVscodeCommands(dump.commands, manifests),
  };
  const file = writeSnapshot(root, "vscode", snapshot);
  const from = [
    `VS Code ${version}`,
    ...picked.map(({ id, version }) => `${id} ${version}`),
  ].join(", ");
  console.log(
    `ids:refresh: wrote ${file}: ${snapshot.commands.length} commands from ${from}`,
  );
}

/** What the dump extension writes. */
type Dump = { vscode: string; activated: string[]; commands: string[] };

/** Settings of the temporary profile: no updates, so the copies keep their versions; no telemetry. */
const SETTINGS = {
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "workbench.enableExperiments": false,
  "workbench.startupEditor": "none",
};

/** The longest wait for VS Code to dump the commands and quit. */
const TIMEOUT_MS = 120_000;

/**
 * Runs VS Code with the dump extension in the directory `temp`, with copies of the extensions to
 * activate, and returns the dump.
 */
async function dumpCommands(
  code: string,
  temp: string,
  extensions: readonly Extension[],
): Promise<Dump> {
  const dirs = {
    userData: join(temp, "user-data"),
    extensions: join(temp, "extensions"),
    workspace: join(temp, "workspace"),
    home: join(temp, "home"),
  };
  mkdirSync(join(dirs.userData, "User"), { recursive: true });
  mkdirSync(dirs.workspace);
  mkdirSync(dirs.home);
  writeFileSync(
    join(dirs.userData, "User/settings.json"),
    `${JSON.stringify(SETTINGS, null, 2)}\n`,
  );
  for (const { dir } of extensions) {
    cpSync(dir, join(dirs.extensions, basename(dir)), { recursive: true });
  }
  const out = join(temp, "commands.json");
  const env: NodeJS.ProcessEnv = {
    // Variables of a VS Code terminal or extension host would steer the new instance.
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(VSCODE|ELECTRON)_/.test(name),
      ),
    ),
    // VS Code reads ~/.vscode/argv.json and the XDG directories; they are temporary too.
    HOME: dirs.home,
    XDG_CONFIG_HOME: join(dirs.home, ".config"),
    XDG_CACHE_HOME: join(dirs.home, ".cache"),
    XDG_DATA_HOME: join(dirs.home, ".local/share"),
    XDG_STATE_HOME: join(dirs.home, ".local/state"),
    VIM_COMPANION_IDS_OUT: out,
    VIM_COMPANION_IDS_ACTIVATE: extensions.map(({ id }) => id).join(","),
  };
  const log = join(temp, "code.log");
  await run(
    "xvfb-run",
    [
      "-a",
      // Without a Wayland display, VS Code uses the X display of xvfb-run.
      "env",
      "-u",
      "WAYLAND_DISPLAY",
      code,
      "--user-data-dir",
      dirs.userData,
      "--extensions-dir",
      dirs.extensions,
      "--extensionDevelopmentPath",
      join(import.meta.dirname, "ids/vscode-dump"),
      "--disable-gpu",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      // Keeps VS Code away from the keyring of the desktop session.
      "--password-store=basic",
      "--new-window",
      dirs.workspace,
    ],
    env,
    log,
  );
  if (!existsSync(out)) {
    throw new Error(
      `VS Code wrote no command IDs; the end of its output:\n${tail(log)}`,
    );
  }
  return readJson(out) as Dump;
}

/**
 * Runs a command in a process group of its own with its output in `log`, and kills the group when
 * the command ends or after TIMEOUT_MS.
 */
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  log: string,
): Promise<void> {
  const output = openSync(log, "w");
  return new Promise<void>((done, fail) => {
    const child = spawn(command, args, {
      env,
      detached: true,
      stdio: ["ignore", output, output],
    });
    const killGroup = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // The group has already ended.
      }
    };
    const timer = setTimeout(() => {
      killGroup();
      fail(new Error(`VS Code did not quit within ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(new Error(`${command}: ${error.message}`));
    });
    child.on("exit", () => {
      clearTimeout(timer);
      // Processes that VS Code left behind.
      killGroup();
      done();
    });
  }).finally(() => closeSync(output));
}

/** The last lines of a log file. */
function tail(path: string): string {
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-20).join("\n");
}

/** The package.json of each directory in `dir` that has one, in code-unit order of the names. */
function manifestsIn(dir: string): { dir: string; manifest: unknown }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name))
    .sort()
    .filter((path) => existsSync(join(path, "package.json")))
    .map((path) => ({
      dir: path,
      manifest: readJson(join(path, "package.json")),
    }));
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
  await main();
} catch (error) {
  console.error(`ids:refresh: ${(error as Error).message}`);
  process.exitCode = 2;
}
