// pnpm ids:refresh vscode|intellij (design §8): rewrites ids/<ide>.json of the spec directory from
// the IDE installed on this machine, and prints what it wrote. Exits 2 when it cannot run, with why
// on stderr, each line after "ids:refresh: ". Stopped by SIGINT, SIGTERM or SIGHUP, vscode ends
// VS Code, removes its temporary directory and exits 130, 143 or 129.
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
import { constants, homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  readJson,
  readJsonFile,
  readSchemas,
  repoPath,
} from "./catalog-files.mts";
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
import { prefixLines, thrownMessage } from "./core/messages.mts";
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
  const dump = await stoppable(async (stop) => {
    const temp = mkdtempSync(join(tmpdir(), "vim-companion-ids-"));
    try {
      return await dumpCommands(code, temp, picked, stop);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  if (dump.vscode !== version) {
    throw new Error(
      `the dump is of VS Code ${dump.vscode}, but ${join(app, "package.json")} has ${version}`,
    );
  }
  const activated = new Set(dump.activated.map((id) => id.toLowerCase()));
  for (const { id, version } of picked) {
    if (!activated.has(`${id}@${version}`.toLowerCase())) {
      throw new Error(`${id} ${version} did not activate in VS Code`);
    }
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

/** How long the processes of a group get to quit after SIGTERM before they get SIGKILL. */
const GRACE_MS = 3_000;

/**
 * The signals that stop a refresh: Ctrl-C in a terminal, kill, and the hang-up of a terminal that
 * closes. Listening for SIGHUP takes nothing from nohup: Node resets SIGHUP to its default action
 * at startup, so under nohup a hang-up still reaches this process.
 */
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** A refresh stopped by a signal; `status` is the exit status that a shell reports for it. */
class Interrupted extends Error {
  readonly status: number;

  constructor(signal: NodeJS.Signals) {
    super(`interrupted by ${signal}`);
    this.status = 128 + constants.signals[signal];
  }
}

/**
 * Runs `work` with an AbortSignal that STOP_SIGNALS abort, with an Interrupted error as the
 * reason. VS Code runs in a session of its own, which neither a Ctrl-C nor the hang-up of the
 * terminal reaches, and without these handlers this process would end at once, leaving VS Code and
 * its temporary directory behind.
 */
async function stoppable<T>(
  work: (stop: AbortSignal) => Promise<T>,
): Promise<T> {
  const stop = new AbortController();
  const onSignal = (signal: NodeJS.Signals) =>
    stop.abort(new Interrupted(signal));
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    return await work(stop.signal);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
  }
}

/**
 * Runs VS Code with the dump extension in the directory `temp`, with copies of the extensions to
 * activate, and returns the dump. When `stop` aborts, it ends VS Code and throws the reason.
 */
async function dumpCommands(
  code: string,
  temp: string,
  extensions: readonly Extension[],
  stop: AbortSignal,
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
  // The X authority file of xvfb-run. Without --auth-file, xvfb-run keeps it in a directory of
  // its own in TMPDIR, which it removes when it exits, but not when a signal ends it.
  const auth = join(temp, "Xauthority");
  writeFileSync(auth, "");
  const log = join(temp, "code.log");
  await run(
    "xvfb-run",
    [
      "-a",
      "--auth-file",
      auth,
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
    stop,
  );
  if (!existsSync(out)) {
    throw new Error(
      `VS Code wrote no command IDs; the end of its output:\n${tail(log)}`,
    );
  }
  return readJson(out) as Dump;
}

/**
 * Runs a command in a process group of its own with its output in `log`. When the command ends,
 * or `stop` aborts first, the processes of the group get to finish their shutdown (endGroup), and
 * then the run settles: with the abort reason once `stop` has aborted. After TIMEOUT_MS, the whole
 * group gets SIGKILL at once.
 */
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  log: string,
  stop: AbortSignal,
): Promise<void> {
  stop.throwIfAborted();
  const output = openSync(log, "w");
  return new Promise<void>((done, fail) => {
    const child = spawn(command, args, {
      env,
      detached: true,
      stdio: ["ignore", output, output],
    });
    const timer = setTimeout(() => {
      signalGroup(child.pid!, "SIGKILL");
      fail(new Error(`VS Code did not quit within ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);
    let ending: Promise<void> | undefined;
    // Ends the group once: after the command, or when `stop` aborts. After the command, the group
    // still holds what VS Code left behind, and Xvfb: xvfb-run sends it SIGTERM on exit without
    // waiting, and Xvfb removes its lock file and socket in /tmp only as it shuts down.
    const end = () => {
      clearTimeout(timer);
      ending ??= endGroup(child.pid!);
      ending.then(() => (stop.aborted ? fail(stop.reason) : done()));
    };
    stop.addEventListener("abort", end, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(new Error(`${command}: ${error.message}`));
    });
    child.on("exit", end);
  }).finally(() => closeSync(output));
}

/**
 * Sends SIGTERM to the processes of a group and waits until none is left, at most GRACE_MS; then
 * kills the ones still there.
 */
async function endGroup(group: number): Promise<void> {
  const deadline = Date.now() + GRACE_MS;
  let running = signalGroup(group, "SIGTERM");
  while (running && Date.now() < deadline) {
    await delay(50);
    running = signalGroup(group, 0);
  }
  if (running) signalGroup(group, "SIGKILL");
}

/** Sends a signal (0: none, a check) to the processes of a group; false when none is left. */
function signalGroup(group: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
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
  return existsSync(path) ? readJsonFile(root, path).data : undefined;
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

/**
 * The concatenated text of the jar entries that match the patterns; "" when none does. In a pattern,
 * "*" does not match "/", so "*.xml" is only the jar root. The entries are listed and matched here
 * because macOS's unzip has no -W, the option that makes unzip match that way.
 */
function unzip(jar: string, patterns: string[]): string {
  const matchers = patterns.map(
    (pattern) =>
      new RegExp(
        `^${pattern
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*")}$`,
      ),
  );
  const names = runUnzip(jar, ["-Z1", jar])
    .split("\n")
    .filter((name) => matchers.some((matcher) => matcher.test(name)));
  if (names.length === 0) return "";
  // unzip reads "*", "?" and "[" in a name as wildcards; a bracket makes each one literal.
  return runUnzip(jar, [
    "-p",
    jar,
    ...names.map((name) => name.replace(/[*?[]/g, "[$&]")),
  ]);
}

function runUnzip(jar: string, args: string[]): string {
  const { status, stdout, stderr, error } = spawnSync("unzip", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (error !== undefined) throw new Error(`unzip: ${error.message}`);
  if (status !== 0)
    throw new Error(`unzip ${jar} exited with ${status}: ${stderr.trim()}`);
  return stdout;
}

try {
  await main();
} catch (error) {
  for (const line of prefixLines("ids:refresh: ", [thrownMessage(error)])) {
    console.error(line);
  }
  process.exitCode = error instanceof Interrupted ? error.status : 2;
}
