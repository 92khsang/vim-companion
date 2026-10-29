const vscode = require("vscode");

let active = false;
let prefix = [];
let watchdog;
const events = [];
const record = (type, extra = {}) =>
  events.push({ t: performance.now(), type, ...extra });

async function end(reason) {
  if (!active) return;
  active = false;
  clearTimeout(watchdog);
  prefix = [];
  await vscode.commands.executeCommand(
    "setContext",
    "vimCompanion.leaderActive",
    false,
  );
  record("end", { reason });
}

function armWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => void end("watchdog"), 5000);
}

async function start() {
  if (active) return;
  active = true;
  prefix = [];
  record("start");
  armWatchdog();
  // VSCodeVim awaits this command; never wait here for its input queue.
  await vscode.commands.executeCommand(
    "setContext",
    "vimCompanion.leaderActive",
    true,
  );
  record("context-on");
}

async function key(value) {
  record("key", { value, active });
  if (!active) return;
  armWatchdog();
  if (["escape", "ctrl+[", "ctrl+c"].includes(value)) {
    await end(value);
    return;
  }
  prefix.push(value);
  if (prefix.join(" ") === "w") return;
  if (prefix.join(" ") !== "w h") {
    await end("undefined-key");
    return;
  }
  try {
    // This editor-targeting leaf releases capture before changing editor focus.
    await end("leaf");
    record("leaf-start", { command: "workbench.action.focusLeftGroup" });
    await vscode.commands.executeCommand("workbench.action.focusLeftGroup");
    record("leaf-end");
  } finally {
    await end("leaf-finally");
  }
}

exports.activate = async (context) => {
  await vscode.commands.executeCommand(
    "setContext",
    "vimCompanion.leaderActive",
    false,
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("vimCompanion.startLeader", start),
    vscode.commands.registerCommand("vimCompanion.leaderKey", key),
    vscode.commands.registerCommand("vimCompanion.resetInputState", () =>
      end("reset"),
    ),
    vscode.window.onDidChangeActiveTextEditor(() => void end("editor-change")),
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) void end("window-blur");
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse)
        void end("mouse");
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length) void end("document-change");
    }),
    { dispose: () => clearTimeout(watchdog) },
  );
  return {
    pid: process.pid,
    snapshot: () => ({ active, prefix: [...prefix], events: [...events] }),
    clearEvents: () => {
      events.length = 0;
    },
  };
};
