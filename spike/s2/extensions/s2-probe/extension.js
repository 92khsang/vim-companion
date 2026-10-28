// Spike S2 probe. It never handles a key: it registers no `type` command and no keybinding.
// It records document, selection and active-editor events, and answers the harness over the
// Unix socket named by S2_PROBE_SOCK with one JSON request or response per line.
const vscode = require("vscode");
const net = require("node:net");
const fs = require("node:fs");

const ADAPTER_ID = "vim-companion-spike.s2-adapter";
const { fieldsOf, toState, handlerFor } = require("./vimstate.js");
const reader = require("./inspect-reader.js");
const { registerContents } = require("./register-contents.js");
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
  visibleRanges: e.visibleRanges.map((r) => [
    r.start.line,
    r.start.character,
    r.end.line,
    r.end.character,
  ]),
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

// Sample keys for the placeholders of an action's key sequence, to complete a proper prefix into
// a full sequence that doesActionApply can judge: a pair that is a default digraph (a:) and a
// quote and a bracket for the surround targets.
const PLACEHOLDER_SAMPLES = {
  "<character>": ["a", ":", '"', "x"],
  "<any>": ["a", ":", '"', "x"],
  "<number>": ["1"],
  "<alpha>": ["a"],
  "<register>": ["a"],
  "<macro>": ["a"],
};
/** Every completion of the key sequence tail with sample keys in place of its placeholders. */
function completionsOf(tail, leader) {
  let out = [[]];
  for (const key of tail) {
    const samples =
      key === "<leader>" ? [leader] : (PLACEHOLDER_SAMPLES[key] ?? [key]);
    out = out.flatMap((c) => samples.map((s) => [...c, s]));
    if (out.length > 256) out = out.slice(0, 256);
  }
  return out;
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
      error: null,
      pollMs: null,
      now: Date.now(),
    };
  }
  // `now` is the time of this read in the extension host, so that the age of the report (now - t)
  // shows whether the adapter is still polling; `error` is the adapter's last polling error.
  return {
    present: true,
    active: true,
    report: ext.exports.latest(),
    error: typeof ext.exports.error === "function" ? ext.exports.error() : null,
    polls: typeof ext.exports.polls === "function" ? ext.exports.polls() : null,
    pollMs: ext.exports.pollMs ?? null,
    now: Date.now(),
  };
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
  vimScroll: async () => ({ scroll: await reader.scrollSetting() }),
  vimHistory: async () => {
    const map = await reader.modeHandlerMap();
    const e = vscode.window.activeTextEditor;
    const h = e && handlerFor(map, e.document.uri.toString());
    if (!h) return { handler: false, documents: map.modeHandlerMap.size };
    const tracker = h.vimState.historyTracker;
    const steps = tracker?.undoStack?.historySteps;
    const index = tracker?.undoStack?.currentStepIndex;
    const current = steps?.[index];
    return {
      handler: true,
      depth: Array.isArray(steps) ? steps.length : null,
      index: Number.isInteger(index) ? index : null,
      totalChanges:
        Array.isArray(steps) && steps.every((s) => Array.isArray(s.changes))
          ? steps.reduce((total, step) => total + step.changes.length, 0)
          : null,
      currentChanges:
        index === -1 && Array.isArray(steps) && steps.length === 0
          ? 0
          : Array.isArray(current?.changes)
            ? current.changes.length
            : null,
      pendingContentChanges: Array.isArray(tracker?.currentContentChanges)
        ? tracker.currentContentChanges.length
        : null,
      currentDocumentMatches:
        tracker?.previousDocumentState?.versionNumber === e.document.version &&
        tracker?.previousDocumentState?.text === e.document.getText(),
    };
  },
  adapter: adapterReport,
  time: () => Date.now(),
  vimModule: () => reader.describeVimModule(),
  // Test-only: the contents of VSCodeVim's registers (its Register.registers map, read as fields;
  // + and * live in the clipboard, which clipboardRead covers). Per register, one entry per cursor
  // with the text (a recorded macro as { keys }) and the RegisterMode name.
  registers: async () => {
    const Register = await reader.registerClass();
    const out = {};
    for (const [name, contents] of Register.registers)
      out[name] = registerContents(name, contents);
    return out;
  },
  // Test-only: the actions of the macro recorded in a register, with the keys each action took
  // (VSCodeVim pushes every action it runs while recording, modeHandler.ts L704-L711, and
  // QuitRecordMacro stores the list, macro.ts L51-L65). spike/s2/check1/keys-proof.mjs reads it to
  // show which key token VSCodeVim received for a key the harness sent.
  macroActions: async ({ name }) => {
    const Register = await reader.registerClass();
    const contents = Register.registers.get(name);
    const first = Array.isArray(contents)
      ? contents[0]
      : (contents?.[0] ?? contents);
    const recorded = first?.text;
    if (!recorded || !Array.isArray(recorded.actionsRun)) return null;
    return recorded.actionsRun.map((a) => ({
      name: a.name ?? a.constructor?.name ?? null,
      keys: [...(a.keysPressed ?? [])],
    }));
  },
  // Test-only: how each register's content list is stored (an array, or the object that a shift
  // of the numbered registers leaves).
  registerShapes: async () => {
    const Register = await reader.registerClass();
    const out = {};
    for (const [name, contents] of Register.registers)
      out[name] = Array.isArray(contents)
        ? "array"
        : `${typeof contents}:${Object.keys(contents ?? {}).join(",")}`;
    return out;
  },
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
  // an action of the action table applies (VSCodeVim's own doesActionApply) or is a proper prefix
  // of a longer key sequence that still applies (couldActionApply on the prefix, and
  // doesActionApply on the sequence completed with sample keys), with the action's keys and type.
  // `prefixOnly` holds the keys that only couldActionApply accepted: a proper prefix of a sequence
  // whose completion does not apply under the settings in force.
  nextKeys: async ({ universe }) => {
    const map = await reader.modeHandlerMap();
    const e = vscode.window.activeTextEditor;
    const h = e && handlerFor(map, e.document.uri.toString());
    if (!h) throw new Error("no ModeHandler for the active editor");
    const table = await reader.actionMap(h);
    const vs = h.vimState;
    const mode = vs.modeData.mode;
    const prefix = [...vs.recordedState.actionKeys];
    const leader =
      vscode.workspace.getConfiguration("vim").get("leader") ?? "\\";
    const rows = {};
    const prefixOnly = {};
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
        let completed = null;
        try {
          does = a.doesActionApply(vs, keys);
        } catch {}
        try {
          // Only a proper prefix counts as "could still apply": for a full-length sequence
          // couldActionApply skips the checks of doesActionApply (such as a setting that is off).
          const seqs = Array.isArray(a.keys[0]) ? a.keys : [a.keys];
          let Base = a.constructor;
          while (Base && typeof Base.CompareKeypressSequence !== "function")
            Base = Object.getPrototypeOf(Base);
          const longer = seqs.filter((q) => q.length > keys.length);
          could =
            longer.length > 0 &&
            Base.CompareKeypressSequence(
              longer.map((q) => q.slice(0, keys.length)),
              keys,
            ) &&
            a.couldActionApply(vs, keys);
          // couldActionApply compares the keys typed so far only; a setting that is off, or a
          // condition on the keys still to come, shows only in doesActionApply of the completed
          // sequence. The prefix stays only if some completion applies.
          if (could) {
            for (const q of longer) {
              if (!Base.CompareKeypressSequence(q.slice(0, keys.length), keys))
                continue;
              for (const tail of completionsOf(q.slice(keys.length), leader)) {
                let ok = false;
                try {
                  ok = a.doesActionApply(vs, [...keys, ...tail]);
                } catch {}
                if (ok) {
                  completed = [...keys, ...tail];
                  break;
                }
              }
              if (completed) break;
            }
          }
        } catch {}
        if (does || completed)
          (rows[k] ??= []).push({
            keys: a.keys,
            type: a.actionType,
            does,
            could: Boolean(completed),
            ...(completed && !does ? { completed } : {}),
          });
        else if (could)
          (prefixOnly[k] ??= []).push({ keys: a.keys, type: a.actionType });
      }
    }
    return {
      mode,
      prefix,
      bufferedKeys: [...vs.recordedState.bufferedKeys],
      state: toState(fieldsOf(h)),
      rows,
      prefixOnly,
    };
  },
  // Test-only: VSCodeVim's real state for the active editor, read through the inspector.
  vimState: async () => {
    const map = await reader.modeHandlerMap();
    const e = vscode.window.activeTextEditor;
    const h = e && handlerFor(map, e.document.uri.toString());
    if (!h) return { handler: false, documents: map.modeHandlerMap.size };
    const fields = fieldsOf(h);
    // `recording`: a macro is being recorded in this document (VSCodeVim keeps vimState.macro per
    // ModeHandler, macro.ts L26); keys-proof.mjs checks it to stop a recording that a key left open.
    return {
      handler: true,
      fields,
      state: toState(fields),
      recording: h.vimState.macro !== undefined,
    };
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
