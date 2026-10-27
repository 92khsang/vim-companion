// Spike S2 harness library: Xvfb, sandboxed VS Code, XTEST keys, the probe client and CDP reads.
//
// Environment (no default points at a real profile):
//   S2_ROOT     sandbox root from `mktemp -d`; holds inst/<name> (user data, extensions, HOME)
//               and ext/base (copies of the VSCodeVim and which-key folders).
//   S2_RUN      a short directory from `mktemp -d /tmp/s2r.XXXXXX` for Unix sockets.
//   S2_CODE_1_134_0, S2_CODE_1_141_0   the code binaries of the two VS Code versions.
//   S2_CPUS     CPU list for taskset (default 8-15).
import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import { dirname, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const REPO = join(import.meta.dirname, "../../..");
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`set ${name}`);
  return v;
};
export const ROOT = () => need("S2_ROOT");
export const RUN = () => need("S2_RUN");
export const CPUS = () => process.env.S2_CPUS ?? "8-15";
export const codeBinary = (version) =>
  need(`S2_CODE_${version.replaceAll(".", "_")}`);

export const SPIKE_EXTENSIONS = join(REPO, "spike/s2/extensions");
export const START = JSON.parse(
  readFileSync(join(REPO, "spec/fixtures/grammar/counts.json"), "utf8"),
).start;

// ---------- build and machine facts recorded with every run ----------

// Records name the sandbox root as $S2_ROOT and the home directory as $HOME (editor URIs, error
// stacks), so that the data files carry no machine-specific path.
export const portable = (text) =>
  [
    [process.env.S2_ROOT, "$S2_ROOT"],
    [process.env.HOME, "$HOME"],
  ].reduce((t, [from, to]) => (from ? t.replaceAll(from, to) : t), text);

// What a run measures besides VS Code and the sandbox base: the spike extensions copied into every
// instance, the differential script, the harness code and the generated settings the sandbox reads.
const BUILD_PATHS = {
  adapter: "spike/s2/extensions/s2-adapter",
  probe: "spike/s2/extensions/s2-probe",
  script: "spike/s2/harness/differential-script.json",
  harness: "spike/s2/harness",
  remaps: "spec/generated/vscode/vim-remaps.json",
  whichkey: "spec/generated/vscode/whichkey-bindings.json",
};
const filesUnder = (abs) =>
  readdirSync(abs, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? filesUnder(join(abs, d.name))
      : d.isFile()
        ? [join(abs, d.name)]
        : [],
  );
const hashPath = (rel) => {
  const abs = join(REPO, rel);
  let files;
  try {
    files = filesUnder(abs);
  } catch {
    files = [abs];
  }
  const h = createHash("sha256");
  for (const f of files.sort()) {
    h.update(relative(REPO, f) + "\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
};
/** sha256 over the sorted relative paths and contents of every file under a directory. */
const hashDir = (abs) => {
  const h = createHash("sha256");
  for (const f of filesUnder(abs).sort()) {
    h.update(relative(abs, f) + "\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
};
/**
 * The software outside the repository that a run measures: the version and product commit of each
 * S2_CODE_* binary (its resources/app/product.json) and a hash of $S2_ROOT/ext/base, the VSCodeVim
 * and which-key folders copied into every instance. No path is recorded.
 */
function externalInfo() {
  const code = {};
  for (const [name, bin] of Object.entries(process.env).sort())
    if (/^S2_CODE_\d+_\d+_\d+$/.test(name)) {
      const label = name.slice("S2_CODE_".length).replaceAll("_", ".");
      const product = JSON.parse(
        readFileSync(join(dirname(bin), "resources/app/product.json"), "utf8"),
      );
      code[label] = { version: product.version, commit: product.commit };
    }
  const base = process.env.S2_ROOT
    ? join(process.env.S2_ROOT, "ext/base")
    : null;
  return {
    code,
    extBase: base && existsSync(base) ? hashDir(base) : null,
    extBaseFolders: base && existsSync(base) ? readdirSync(base).sort() : [],
  };
}
/**
 * The build a run measures: the checkout's HEAD, the uncommitted changes under spike/s2 and spec
 * (data directories excluded), sha256 hashes of BUILD_PATHS, and the software outside the
 * repository (externalInfo). `id` is a short hash of all of it; the compare and the summaries
 * refuse records of more than one id, and records of a build with uncommitted changes.
 */
export function buildInfo() {
  const git = (args) =>
    execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
  const head = git(["rev-parse", "HEAD"]);
  const dirty = git([
    "status",
    "--porcelain",
    "--",
    "spike/s2",
    "spec",
    ":!spike/s2/data",
  ]);
  const sha256 = Object.fromEntries(
    Object.entries(BUILD_PATHS).map(([k, p]) => [k, hashPath(p)]),
  );
  const external = externalInfo();
  const id = createHash("sha256")
    .update(JSON.stringify({ head, dirty, sha256, external }))
    .digest("hex")
    .slice(0, 16);
  return { id, head, dirty: dirty ? dirty.split("\n") : [], sha256, external };
}

/**
 * Whether the adapter is really at work (arm on) or really absent (arm off), from the probe's
 * `adapter` method: with the adapter on, it must be present and active, its latest report must
 * hold a state, its last polling error must be null, and the report must be at most two poll
 * intervals old; with the adapter off, the extension must be absent (disabled extensions are not
 * listed). A failed inspector walk leaves the adapter active with no report, which this catches.
 */
export const NEUTRAL_STATE = {
  mode: "normal",
  pending: [],
  operator: null,
  count: null,
  register: null,
};
/**
 * The adapter's report, as adapterCheck reads it. With `activeUri`, the report must be for that
 * document (the active editor at the read); with `neutral`, its state must be Normal mode with
 * nothing pending, no operator, count or register (the state after <Esc> <Esc>). Right after the
 * adapter, the probe's own test-only reader (the inspector reader of the fixture deviations) reads
 * VSCodeVim's state in both arms; the check records it, whether it is neutral and, with the adapter
 * on, whether it equals the adapter's report, so that a failure of the neutral check can be put on
 * VSCodeVim's end state or on the adapter. The reader does not change the pass rule.
 */
export async function adapterCheck(code, arm, { activeUri, neutral } = {}) {
  const a = await code.probe.call("adapter");
  let reader;
  try {
    const r = await code.probe.call("vimState");
    reader = { state: r.state ?? null, handler: r.handler };
  } catch (e) {
    reader = { state: null, error: String(e) };
  }
  const ageMs = a.report ? a.now - a.report.t : null;
  const reasons = [];
  if (arm === "on") {
    if (!a.present) reasons.push("adapter not present");
    if (!a.active) reasons.push("adapter not active");
    if (!a.report) reasons.push("no adapter report");
    else if (!a.report.state) reasons.push("adapter report without a state");
    if (a.error) reasons.push(`adapter error: ${a.error}`);
    if (a.report && !(ageMs >= 0 && ageMs <= 2 * (a.pollMs ?? 50)))
      reasons.push(`adapter report ${ageMs} ms old`);
    if (a.report && activeUri !== undefined && a.report.uri !== activeUri)
      reasons.push(
        "adapter report for another document than the active editor",
      );
    if (
      a.report?.state &&
      neutral &&
      JSON.stringify(a.report.state) !== JSON.stringify(NEUTRAL_STATE)
    )
      reasons.push(
        `adapter state after <Esc> <Esc> is not neutral: ${JSON.stringify(a.report.state)}`,
      );
  } else if (a.present) reasons.push("adapter present with the adapter off");
  return {
    arm,
    present: a.present,
    active: a.active,
    ageMs,
    pollMs: a.pollMs,
    polls: a.polls ?? null,
    error: a.error,
    uri: a.report?.uri ?? null,
    uriMatches:
      activeUri === undefined || !a.report ? null : a.report.uri === activeUri,
    state: a.report?.state ?? null,
    reader: {
      ...reader,
      neutral: reader.state
        ? JSON.stringify(reader.state) === JSON.stringify(NEUTRAL_STATE)
        : null,
      equalsAdapter:
        arm === "on" && a.report?.state && reader.state
          ? JSON.stringify(reader.state) === JSON.stringify(a.report.state)
          : null,
    },
    ok: reasons.length === 0,
    reasons,
  };
}

/** The CPU numbers of a taskset list such as 8-15 or 8-11,14. */
export const cpuList = (spec) =>
  spec.split(",").flatMap((part) => {
    const [a, b = a] = part.split("-").map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });

// ---------- X display ----------

export async function startXvfb(display) {
  const p = spawn(
    "Xvfb",
    [display, "-screen", "0", "1600x1000x24", "-nolisten", "tcp", "-noreset"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  p.unref();
  for (let i = 0; i < 100; i++) {
    try {
      execFileSync("xdpyinfo", ["-display", display], { stdio: "ignore" });
      execFileSync("setxkbmap", ["-display", display, "us"]);
      return p.pid;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Xvfb ${display} did not start`);
}

export const xdo = (display, args) =>
  execFileSync("xdotool", args, {
    env: { PATH: process.env.PATH, DISPLAY: display },
    encoding: "utf8",
  });

const KEYSYM = {
  '"': "quotedbl",
  "'": "apostrophe",
  "`": "grave",
  "<": "less",
  ">": "greater",
  "~": "asciitilde",
  "[": "bracketleft",
  "]": "bracketright",
  "@": "at",
  "+": "plus",
  _: "underscore",
  "-": "minus",
  ".": "period",
  ":": "colon",
  "/": "slash",
  "?": "question",
  "(": "parenleft",
  ")": "parenright",
  "{": "braceleft",
  "}": "braceright",
  ",": "comma",
  ";": "semicolon",
  "!": "exclam",
  "#": "numbersign",
  $: "dollar",
  "%": "percent",
  "^": "asciicircum",
  "&": "ampersand",
  "*": "asterisk",
  "=": "equal",
  "|": "bar",
  "\\": "backslash",
  "<Esc>": "Escape",
  "<Space>": "space",
  "<CR>": "Return",
  "<Tab>": "Tab",
  "<BS>": "BackSpace",
};
export function keysym(key) {
  if (KEYSYM[key]) return KEYSYM[key];
  const ctrl = /^<C-([a-z])>$/.exec(key);
  if (ctrl) return `ctrl+${ctrl[1]}`;
  if (/^[a-zA-Z0-9]$/.test(key)) return key;
  throw new Error(`no keysym for ${key}`);
}

/** Types keys through XTEST (no --window, so no XSendEvent) with the given delay between keys. */
export function typeKeys(display, keys, delayMs) {
  if (keys.length === 0) return;
  xdo(display, [
    "key",
    "--clearmodifiers",
    "--delay",
    String(delayMs),
    ...keys.map(keysym),
  ]);
}

// ---------- probe client ----------

export class Probe {
  constructor(sockPath) {
    this.sockPath = sockPath;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = "";
  }
  async connect(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const s = net.createConnection(this.sockPath);
          s.once("connect", () => {
            this.sock = s;
            resolve();
          });
          s.once("error", reject);
        });
        break;
      } catch {
        await sleep(250);
      }
    }
    if (!this.sock) throw new Error(`probe socket ${this.sockPath} not ready`);
    this.sock.setEncoding("utf8");
    this.sock.on("data", (chunk) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 1);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
        }
      }
    });
    this.sock.on("error", () => {});
    return this;
  }
  call(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`probe ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.sock.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  close() {
    this.sock?.destroy();
  }
}

// ---------- VS Code sandbox ----------

export function sandboxSettings(extra = {}) {
  const remaps = JSON.parse(
    readFileSync(join(REPO, "spec/generated/vscode/vim-remaps.json"), "utf8"),
  );
  const whichkey = JSON.parse(
    readFileSync(
      join(REPO, "spec/generated/vscode/whichkey-bindings.json"),
      "utf8",
    ),
  );
  return {
    // Harness conditions of issue #11: no auto closing, auto indent, format on type or suggestions.
    "editor.autoClosingBrackets": "never",
    "editor.autoClosingQuotes": "never",
    "editor.autoClosingComments": "never",
    "editor.autoClosingOvertype": "never",
    "editor.autoClosingDelete": "never",
    "editor.autoSurround": "never",
    "editor.autoIndent": "none",
    "editor.formatOnType": false,
    "editor.formatOnPaste": false,
    "editor.quickSuggestions": {
      other: "off",
      comments: "off",
      strings: "off",
    },
    "editor.suggestOnTriggerCharacters": false,
    "editor.acceptSuggestionOnEnter": "off",
    "editor.wordBasedSuggestions": "off",
    "editor.parameterHints.enabled": false,
    "editor.inlineSuggest.enabled": false,
    "editor.snippetSuggestions": "none",
    "editor.tabCompletion": "off",
    "editor.linkedEditing": false,
    "editor.minimap.enabled": false,
    // A sandbox that stays offline and quiet.
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "extensions.ignoreRecommendations": true,
    "telemetry.telemetryLevel": "off",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.enableExperiments": false,
    "workbench.settings.enableNaturalLanguageSearch": false,
    "security.workspace.trust.enabled": false,
    "window.restoreWindows": "none",
    "window.newWindowDimensions": "maximized",
    "files.hotExit": "off",
    "files.autoSave": "off",
    "git.enabled": false,
    "github.copilot.enable": { "*": false },
    "chat.disableAIFeatures": true,
    "chat.commandCenter.enabled": false,
    "settingsSync.keybindingsPerPlatform": false,
    ...remaps,
    "whichkey.bindings": whichkey,
    ...extra,
  };
}

export function prepareInstance({
  name,
  spikeExtensions = ["s2-probe"],
  settings = {},
}) {
  const inst = join(ROOT(), "inst", name);
  rmSync(inst, { recursive: true, force: true });
  for (const d of ["data/User", "ext", "home", "ws", "logs"])
    mkdirSync(join(inst, d), { recursive: true });
  writeFileSync(
    join(inst, "data/User/settings.json"),
    JSON.stringify(sandboxSettings(settings), null, 2),
  );
  for (const e of readdirSync(join(ROOT(), "ext/base"))) {
    cpSync(join(ROOT(), "ext/base", e), join(inst, "ext", e), {
      recursive: true,
    });
  }
  for (const e of spikeExtensions) {
    const dest = join(inst, "ext", `vim-companion-spike.${e}-0.0.1`);
    cpSync(join(SPIKE_EXTENSIONS, e), dest, { recursive: true });
    // The adapter uses the probe's field mapper and reader: one source, copied at install time.
    if (e === "s2-adapter") {
      for (const f of ["vimstate.js", "inspect-reader.js"]) {
        cpSync(join(SPIKE_EXTENSIONS, "s2-probe", f), join(dest, f));
      }
    }
  }
  const text = START.lines.join("\n") + "\n";
  writeFileSync(join(inst, "ws/a.txt"), text);
  writeFileSync(join(inst, "ws/b.txt"), text);
  return inst;
}

/**
 * Starts VS Code in a sandbox: its own user data, extensions, HOME and XDG directories, a
 * private D-Bus session (dbus-run-session), no input method variables, X11 on the given
 * display, pinned to S2_CPUS. Returns { pid, pgid, probe, wid, inst, hello }.
 */
export async function startCode({
  version,
  display,
  name,
  disable = [],
  cdpPort,
  inst,
}) {
  const sock = join(RUN(), `${name}.sock`);
  // A new runtime directory per start: D-Bus services that the sandbox activated (the document
  // portal, gvfsd) can keep FUSE mounts in the old one for a moment after VS Code stops.
  const rt = join(RUN(), `${name}.${Date.now().toString(36)}.rt`);
  mkdirSync(rt, { recursive: true, mode: 0o700 });
  const home = join(inst, "home");
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: rt,
    DISPLAY: display,
    LANG: "en_US.UTF-8",
    S2_PROBE_SOCK: sock,
    VSCODE_SKIP_PRELAUNCH: "1",
  };
  const args = [
    `--user-data-dir=${join(inst, "data")}`,
    `--extensions-dir=${join(inst, "ext")}`,
    "--ozone-platform=x11",
    // The 1.134.0 archive has no setuid chrome-sandbox and this OS restricts user namespaces for
    // binaries without an AppArmor profile, so Chromium's sandbox cannot start there. Both versions
    // run without it, so that their arguments stay the same.
    "--no-sandbox",
    "--password-store=basic",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-telemetry",
    "--new-window",
    ...disable.map((id) => `--disable-extension=${id}`),
    ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
    join(inst, "ws"),
  ];
  // `detached` starts the child in a new session, so its pid is the process group of everything
  // the session starts (dbus-daemon, VS Code, the services the bus activates). The setsid binary
  // would fork again here, because the child is already a group leader, and leave a stale pid.
  const p = spawn(
    "taskset",
    ["-c", CPUS(), "dbus-run-session", "--", codeBinary(version), ...args],
    {
      env,
      detached: true,
      stdio: [
        "ignore",
        openSync(join(inst, "logs/code.log"), "a"),
        openSync(join(inst, "logs/code.log"), "a"),
      ],
    },
  );
  p.unref();
  let probe;
  let hello;
  try {
    probe = await new Probe(sock).connect();
    hello = await probe.call("hello");
  } catch (e) {
    await stopCode({ pid: p.pid, rt });
    throw e;
  }
  let wid;
  for (let i = 0; i < 100 && !wid; i++) {
    try {
      // The workbench window carries the title "... - Visual Studio Code"; Electron also maps
      // helper windows of the same class.
      wid = xdo(display, [
        "search",
        "--onlyvisible",
        "--name",
        "Visual Studio Code",
      ])
        .trim()
        .split("\n")
        .at(-1);
    } catch {
      await sleep(200);
    }
  }
  return { pid: p.pid, probe, wid, inst, hello, display, rt };
}

export function focus(code) {
  xdo(code.display, ["windowactivate", "--sync", code.wid]);
}

export function focusWindow(code) {
  xdo(code.display, ["windowfocus", "--sync", code.wid]);
}

/** Pids of the processes whose environment names the given runtime directory. */
function sessionPids(rt) {
  const marker = `XDG_RUNTIME_DIR=${rt}\0`;
  const pids = [];
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    try {
      if (readFileSync(`/proc/${d}/environ`, "latin1").includes(marker))
        pids.push(Number(d));
    } catch {}
  }
  return pids;
}

/**
 * Stops a sandboxed VS Code by its process group (the spawned pid leads it), then every process
 * that still carries the session's runtime directory in its environment: the bus the session
 * started and the services it activated (gvfsd and its FUSE mount, the portals, at-spi).
 */
export async function stopCode(code) {
  code.probe?.close();
  try {
    process.kill(-code.pid, "SIGTERM");
  } catch {}
  let gone = false;
  for (let i = 0; i < 50 && !gone; i++) {
    try {
      process.kill(-code.pid, 0);
      await sleep(200);
    } catch {
      gone = true;
    }
  }
  if (!gone) {
    try {
      process.kill(-code.pid, "SIGKILL");
    } catch {}
  }
  if (code.rt) {
    for (let i = 0; i < 50; i++) {
      const pids = sessionPids(code.rt);
      if (pids.length === 0) break;
      for (const pid of pids) {
        try {
          process.kill(pid, i < 25 ? "SIGTERM" : "SIGKILL");
        } catch {}
      }
      await sleep(200);
    }
  }
  // Helpers that left the process group (crashpad, a file watcher) still name the sandbox
  // directory in their arguments; they are this sandbox's own processes.
  if (code.inst) {
    for (let i = 0; i < 50; i++) {
      let pids = [];
      try {
        pids = execFileSync("pgrep", ["-f", code.inst], { encoding: "utf8" })
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(Number);
      } catch {
        return;
      }
      for (const pid of pids) {
        try {
          process.kill(pid, i < 25 ? "SIGTERM" : "SIGKILL");
        } catch {}
      }
      await sleep(200);
    }
  }
}

// ---------- CDP (renderer DOM) ----------

export async function cdpEvaluate(port, expression) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /workbench/.test(t.url));
  if (!page) throw new Error("no workbench page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const result = await new Promise((resolve, reject) => {
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id === 1)
        msg.error
          ? reject(new Error(msg.error.message))
          : resolve(msg.result.result.value);
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }),
    );
  });
  ws.close();
  return result;
}

export const STATUS_BAR_JS = `[...document.querySelectorAll('.statusbar-item')].map(e => [e.id, e.textContent.trim()]).filter(([id]) => /vim/i.test(id))`;

/**
 * Starts a sandboxed VS Code with a.txt in group 1 and b.txt in group 2, waits until VSCodeVim
 * is active, focuses the window through XTEST and the first editor group, and resets a.txt to
 * the fixture start. Returns the code handle with `settle()` and `reset()` helpers.
 */
export async function openSession({
  version,
  display,
  name,
  cdpPort,
  disable = [],
  spikeExtensions,
  settings,
  onHostUp,
}) {
  const inst = prepareInstance({ name, spikeExtensions, settings });
  const code = await startCode({
    version,
    display,
    name: name.replaceAll(".", ""),
    inst,
    cdpPort,
    disable,
  });
  // The probe has answered its first hello (startCode); a harness that sorts its errors by phase
  // moves from `boot` to `start` here. The adapter, which activates on the same event as the probe,
  // is already loaded at this point.
  onHostUp?.();
  for (let i = 0; i < 150; i++) {
    const h = await code.probe.call("hello");
    code.hello = h;
    if (h.vim?.active) break;
    await sleep(200);
  }
  if (!code.hello.vim?.active) throw new Error("VSCodeVim did not activate");
  await code.probe.call("open", {
    files: [
      { path: join(inst, "ws/a.txt"), viewColumn: 1 },
      { path: join(inst, "ws/b.txt"), viewColumn: 2 },
    ],
  });
  focusWindow(code);
  await code.probe.call("exec", {
    command: "workbench.action.focusFirstEditorGroup",
  });
  await sleep(300);
  code.cdpPort = cdpPort;
  return code;
}

/** Evaluates an expression in the inner frame of the webview of an extension, over CDP. */
export async function cdpWebviewEvaluate(port, extensionId, expression) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const frames = list.filter(
    (t) =>
      (/vscode-webview/.test(t.url) &&
        t.url.includes(encodeURIComponent(extensionId).replace(/%2E/g, "."))) ||
      (/vscode-webview/.test(t.url) && t.url.includes(extensionId)),
  );
  if (frames.length === 0)
    throw new Error(
      `no webview target for ${extensionId}: ${list.map((t) => t.type + " " + t.url.slice(0, 80)).join(" | ")}`,
    );
  const target = frames[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const wrapped = `(() => { const f = document.querySelector('iframe#active-frame'); const doc = f ? f.contentDocument : document; return (${expression})(doc); })()`;
  const result = await new Promise((resolve, reject) => {
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id === 1)
        msg.error
          ? reject(new Error(msg.error.message))
          : resolve(msg.result.result.value);
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression: wrapped, returnByValue: true },
      }),
    );
  });
  ws.close();
  return result;
}

/** Reads the rendered cards: per card, the text of the row header cells (th scope=row). */
export const CARDS_DOM_JS = `(doc) => [...doc.querySelectorAll('section.card')].map((s) => ({ id: s.dataset.card, keys: [...s.querySelectorAll('tbody th[scope=row]')].map((th) => th.textContent), headers: [...s.querySelectorAll('thead th[scope=col]')].map((th) => th.textContent) }))`;
