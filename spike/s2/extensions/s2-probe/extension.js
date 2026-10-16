// Spike S2 probe. It never handles a key: it registers no `type` command and no keybinding.
// It records document, selection and active-editor events, and answers the harness over the
// Unix socket named by S2_PROBE_SOCK with one JSON request or response per line.
const vscode = require("vscode");
const net = require("node:net");
const fs = require("node:fs");

const ADAPTER_ID = "vim-companion-spike.s2-adapter";
const { fieldsOf, toState, handlerFor } = require("./vimstate.js");
const reader = require("./inspect-reader.js");
const events = [];
const record = (type, data) => {
  events.push({ t: Date.now(), type, ...data });
  if (events.length > 5000) events.splice(0, events.length - 5000);
};

const sel = (s) => [
  s.anchor.line,
  s.anchor.character,
  s.active.line,
  s.active.character,
];
const editorState = (e) => ({
  uri: e.document.uri.toString(),
  viewColumn: e.viewColumn ?? null,
  text: e.document.getText(),
  selections: e.selections.map(sel),
});

async function openFiles({ files }) {
  // files: [{ path, viewColumn }]; the first one ends active.
  for (const f of [...files].reverse()) {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(f.path),
    );
    await vscode.window.showTextDocument(doc, {
      viewColumn: f.viewColumn,
      preview: false,
    });
  }
  return snapshot();
}

async function reset({ lines, cursor }) {
  const e = vscode.window.activeTextEditor;
  if (!e) throw new Error("no active editor");
  const text = lines.join("\n") + "\n";
  if (e.document.getText() !== text) {
    const all = new vscode.Range(0, 0, e.document.lineCount, 0);
    const ok = await e.edit((b) => b.replace(all, text), {
      undoStopBefore: true,
      undoStopAfter: true,
    });
    if (!ok) throw new Error("edit failed");
  }
  const p = new vscode.Position(cursor.line, cursor.column);
  // Set the selection only when it differs: an API selection change reaches VSCodeVim as an outside
  // change, even when it repeats the current selection.
  if (
    e.selections.length !== 1 ||
    !e.selection.isEmpty ||
    !e.selection.active.isEqual(p)
  ) {
    e.selection = new vscode.Selection(p, p);
  }
  return editorState(e);
}

function snapshot() {
  const active = vscode.window.activeTextEditor;
  return {
    active: active ? active.document.uri.toString() : null,
    activeViewColumn: active?.viewColumn ?? null,
    editors: vscode.window.visibleTextEditors.map(editorState),
  };
}

function adapterReport() {
  const ext = vscode.extensions.getExtension(ADAPTER_ID);
  if (
    !ext ||
    !ext.isActive ||
    !ext.exports ||
    typeof ext.exports.latest !== "function"
  ) {
    return {
      present: Boolean(ext),
      active: Boolean(ext?.isActive),
      report: null,
    };
  }
  return { present: true, active: true, report: ext.exports.latest() };
}

const methods = {
  hello: () => {
    const vim = vscode.extensions.getExtension("vscodevim.vim");
    const wk = vscode.extensions.getExtension("VSpaceCode.whichkey");
    const ad = vscode.extensions.getExtension(ADAPTER_ID);
    return {
      vscode: vscode.version,
      pid: process.pid,
      vim: vim
        ? { version: vim.packageJSON.version, active: vim.isActive }
        : null,
      whichkey: wk
        ? { version: wk.packageJSON.version, active: wk.isActive }
        : null,
      adapter: ad
        ? { version: ad.packageJSON.version, active: ad.isActive }
        : null,
      extensions: vscode.extensions.all
        .filter((x) => !x.packageJSON.isBuiltin)
        .map((x) => x.id),
    };
  },
  open: openFiles,
  reset,
  snapshot,
  events: ({ clear } = {}) => {
    const out = events.slice();
    if (clear) events.length = 0;
    return out;
  },
  clipboardRead: async () => vscode.env.clipboard.readText(),
  clipboardWrite: async ({ text }) => vscode.env.clipboard.writeText(text),
  exec: async ({ command, args = [] }) => {
    const r = await vscode.commands.executeCommand(command, ...args);
    return r === undefined ? null : JSON.parse(JSON.stringify(r));
  },
  config: ({ section, key }) =>
    vscode.workspace.getConfiguration(section).get(key),
  adapter: adapterReport,
  time: () => Date.now(),
  vimModule: () => reader.describeVimModule(),
  // Test-only: every key token of VSCodeVim's action table, over all modes.
  tableKeys: async () => {
    const map = await reader.modeHandlerMap();
    const h = [...map.modeHandlerMap.values()][0];
    const table = await reader.actionMap(h);
    const tokens = new Set();
    let actions = 0;
    for (const classes of table.values()) {
      for (const C of classes) {
        let a;
        try {
          a = new C();
        } catch {
          continue;
        }
        actions += 1;
        const seqs = Array.isArray(a.keys[0]) ? a.keys : [a.keys];
        for (const seq of seqs) for (const k of seq) tokens.add(k);
      }
    }
    return { actions, modes: [...table.keys()], tokens: [...tokens].sort() };
  },
  // Test-only: for the active editor's real VSCodeVim state, the keys of the universe after which
  // an action of the action table applies or could still apply (VSCodeVim's own doesActionApply
  // and couldActionApply), with the action's keys and type.
  nextKeys: async ({ universe }) => {
    const map = await reader.modeHandlerMap();
    const e = vscode.window.activeTextEditor;
    const h = e && handlerFor(map, e.document.uri.toString());
    if (!h) throw new Error("no ModeHandler for the active editor");
    const table = await reader.actionMap(h);
    const vs = h.vimState;
    const mode = vs.modeData.mode;
    const prefix = [...vs.recordedState.actionKeys];
    const rows = {};
    for (const C of table.get(mode) ?? []) {
      let a;
      try {
        a = new C();
      } catch {
        continue;
      }
      for (const k of universe) {
        const keys = [...prefix, k];
        let does = false;
        let could = false;
        try {
          does = a.doesActionApply(vs, keys);
        } catch {}
        try {
          could = a.couldActionApply(vs, keys);
        } catch {}
        if (does || could)
          (rows[k] ??= []).push({
            keys: a.keys,
            type: a.actionType,
            does,
            could,
          });
      }
    }
    return {
      mode,
      prefix,
      bufferedKeys: [...vs.recordedState.bufferedKeys],
      state: toState(fieldsOf(h)),
      rows,
    };
  },
  // Test-only: VSCodeVim's real state for the active editor, read through the inspector.
  vimState: async () => {
    const map = await reader.modeHandlerMap();
    const e = vscode.window.activeTextEditor;
    const h = e && handlerFor(map, e.document.uri.toString());
    if (!h) return { handler: false, documents: map.modeHandlerMap.size };
    const fields = fieldsOf(h);
    return { handler: true, fields, state: toState(fields) };
  },
};

function activate(context) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0) {
        record("text", {
          uri: e.document.uri.toString(),
          changes: e.contentChanges.map((c) => c.text),
        });
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) =>
      record("selection", {
        uri: e.textEditor.document.uri.toString(),
        kind: e.kind ?? null,
        selections: e.selections.map(sel),
      }),
    ),
    vscode.window.onDidChangeActiveTextEditor((e) =>
      record("active", { uri: e ? e.document.uri.toString() : null }),
    ),
  );
  const sockPath = process.env.S2_PROBE_SOCK;
  if (!sockPath) return;
  try {
    fs.unlinkSync(sockPath);
  } catch {}
  const server = net.createServer((sock) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", async (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let req;
        try {
          req = JSON.parse(line);
          const fn = methods[req.method];
          if (!fn) throw new Error(`unknown method ${req.method}`);
          const result = await fn(req.params ?? {});
          sock.write(
            JSON.stringify({
              id: req.id,
              result: result === undefined ? null : result,
            }) + "\n",
          );
        } catch (err) {
          sock.write(
            JSON.stringify({
              id: req?.id ?? null,
              error: String(err?.stack ?? err),
            }) + "\n",
          );
        }
      }
    });
    sock.on("error", () => {});
  });
  server.listen(sockPath);
  context.subscriptions.push({ dispose: () => server.close() });
}

module.exports = { activate, deactivate() {} };
