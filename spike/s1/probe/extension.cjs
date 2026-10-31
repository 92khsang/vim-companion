const vscode = require("vscode");
const net = require("node:net");
const { createHash } = require("node:crypto");
const reader = require("./inspect-reader.cjs");
const { registerContents } = require("./register-contents.cjs");
let map, Register, queue, leader, load;
let delivery = [];
let sentinel = null;
let sentinelSequence = 0;
let documents;

function documentState(document) {
  const text = document.getText();
  return {
    uri: document.uri.toString(),
    scheme: document.uri.scheme,
    version: document.version,
    languageId: document.languageId,
    isDirty: document.isDirty,
    length: text.length,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function recordDocument(type, document, extra = {}) {
  if (!documents) return;
  if (documents.events.length >= 2048) {
    documents.overflow += 1;
    return;
  }
  const editor = vscode.window.activeTextEditor;
  documents.events.push({
    t: performance.now(),
    type,
    document: documentState(document),
    activeEditor: editor ? documentState(editor.document) : null,
    isActiveDocument: editor?.document === document,
    // The leader listener was registered first and may already have set active=false.
    leaderAtObservation: leader?.snapshot() ?? null,
    ...extra,
  });
}

function snapshot() {
  const e = vscode.window.activeTextEditor;
  const handler =
    e &&
    [...map.modeHandlerMap].find(
      ([uri]) => String(uri) === e.document.uri.toString(),
    )?.[1];
  const state = handler?.vimState;
  const recorded = state?.recordedState;
  return {
    viewColumn: e?.viewColumn ?? null,
    text: e?.document.getText() ?? null,
    selections:
      e?.selections.map((s) => [
        s.anchor.line,
        s.anchor.character,
        s.active.line,
        s.active.character,
      ]) ?? [],
    mode: state?.modeData.mode ?? null,
    pending: recorded && {
      actionKeys: [...recorded.actionKeys],
      bufferedKeys: [...recorded.bufferedKeys],
      actionsRunPressedKeys: [...recorded.actionsRunPressedKeys],
      count: recorded.count,
      operatorCount: recorded.operatorCount,
      registerName: recorded.registerName,
    },
    registers: Object.fromEntries(
      [...Register.registers].map(([name, value]) => [
        name,
        registerContents(name, value),
      ]),
    ),
    queue: {
      pending: queue.pending,
      jobs: queue.jobs.length,
      running: queue.running,
    },
    leader: leader?.snapshot() ?? null,
    sentinel,
    sentinelSequence,
  };
}

async function position(editor, line = 0) {
  const p = new vscode.Position(line, 0);
  if (!editor.selection.isEmpty || !editor.selection.active.isEqual(p))
    editor.selection = new vscode.Selection(p, p);
}

exports.activate = async (context) => {
  await vscode.extensions.getExtension("vscodevim.vim").activate();
  leader = await vscode.extensions
    .getExtension("vim-companion-spike.s1-leader")
    ?.activate();
  load = await vscode.extensions
    .getExtension("vim-companion-spike.s1-load")
    ?.activate();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) =>
      recordDocument("open", document),
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!documents) return;
      recordDocument("change", event.document, {
        reason: event.reason ?? null,
        contentChanges: event.contentChanges.map((change) => ({
          range: [
            change.range.start.line,
            change.range.start.character,
            change.range.end.line,
            change.range.end.character,
          ],
          rangeOffset: change.rangeOffset,
          rangeLength: change.rangeLength,
          text: change.text,
        })),
      });
    }),
    vscode.commands.registerCommand("s1.deliveryKey", (key) =>
      delivery.push({ key, t: performance.now() }),
    ),
    vscode.commands.registerCommand("s1.sentinel", (value) => {
      sentinel = value;
      sentinelSequence += 1;
    }),
  );
  const methods = {
    documents: ({ start = false }) => {
      if (start) {
        if (documents) throw new Error("document recording already started");
        documents = {
          startedAt: performance.now(),
          initial: vscode.workspace.textDocuments.map(documentState),
          events: [],
          overflow: 0,
        };
      }
      return documents;
    },
    diagnose: async () => {
      await vscode.commands.executeCommand(
        "workbench.action.toggleKeybindingsLog",
      );
      await vscode.commands.executeCommand(
        "workbench.action.focusActiveEditorGroup",
      );
      return true;
    },
    hello: () => ({
      vscode: vscode.version,
      vim: vscode.extensions.getExtension("vscodevim.vim").packageJSON.version,
      pid: process.pid,
      leaderPid: leader?.pid ?? null,
      loadPid: load?.pid ?? null,
      extensions: vscode.extensions.all.map((extension) => extension.id).sort(),
    }),
    loadWindows: () => load?.windows() ?? [],
    open: async ({ file }) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(file),
      );
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
      });
      await vscode.commands.executeCommand("workbench.action.splitEditorRight");
      return true;
    },
    warm: async () => {
      map = await reader.modeHandlerMap();
      Register = await reader.registerClass();
      queue = await reader.keyQueue();
      return snapshot();
    },
    snapshot,
    delivery: async ({ enabled }) => {
      if (enabled) delivery = [];
      await vscode.commands.executeCommand(
        "setContext",
        "s1.delivery",
        enabled,
      );
      return delivery;
    },
    prepare: async () => {
      await vscode.commands.executeCommand("workbench.action.focusLeftGroup");
      await position(vscode.window.activeTextEditor);
      await vscode.commands.executeCommand("workbench.action.focusRightGroup");
      await position(vscode.window.activeTextEditor);
      leader?.clearEvents();
      sentinel = null;
      return true;
    },
    text: async ({ value }) => {
      const e = vscode.window.activeTextEditor;
      if (e.document.getText() !== value) {
        const ok = await e.edit((b) =>
          b.replace(new vscode.Range(0, 0, e.document.lineCount, 0), value),
        );
        if (!ok) throw new Error("buffer reset rejected");
      }
      await position(e);
      return true;
    },
    reset: async () => {
      await vscode.commands.executeCommand("vimCompanion.resetInputState");
      return true;
    },
  };
  const server = net.createServer((socket) => {
    let buffer = "";
    let chain = Promise.resolve();
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        chain = chain.then(async () => {
          const request = JSON.parse(line);
          try {
            if (!methods[request.method])
              throw new Error("unknown probe method");
            socket.write(
              JSON.stringify({
                id: request.id,
                result: await methods[request.method](request.params ?? {}),
              }) + "\n",
            );
          } catch (error) {
            socket.write(
              JSON.stringify({ id: request.id, error: String(error) }) + "\n",
            );
          }
        });
      }
    });
  });
  server.listen(process.env.S1_SOCKET);
  context.subscriptions.push({ dispose: () => server.close() });
};
