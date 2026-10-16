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
import net from "node:net";
import { join } from "node:path";
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
  const rt = join(RUN(), `${name}.rt`);
  rmSync(rt, { recursive: true, force: true });
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
  const p = spawn(
    "setsid",
    [
      "taskset",
      "-c",
      CPUS(),
      "dbus-run-session",
      "--",
      codeBinary(version),
      ...args,
    ],
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
    await stopCode({ pid: p.pid });
    throw e;
  }
  let wid;
  for (let i = 0; i < 100 && !wid; i++) {
    try {
      wid = xdo(display, ["search", "--onlyvisible", "--class", "code"])
        .trim()
        .split("\n")
        .at(-1);
    } catch {
      await sleep(200);
    }
  }
  return { pid: p.pid, probe, wid, inst, hello, display };
}

export function focus(code) {
  xdo(code.display, ["windowactivate", "--sync", code.wid]);
}

export function focusWindow(code) {
  xdo(code.display, ["windowfocus", "--sync", code.wid]);
}

/** Stops a sandboxed VS Code by its process group (setsid made the spawned pid the group leader). */
export async function stopCode(code) {
  code.probe?.close();
  try {
    process.kill(-code.pid, "SIGTERM");
  } catch {}
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(-code.pid, 0);
      await sleep(200);
    } catch {
      return;
    }
  }
  try {
    process.kill(-code.pid, "SIGKILL");
  } catch {}
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
