// Spike S2 candidate (a), inspector build (option 2 of the note on issue #11; measured only if the
// user chooses it). It reads require.cache to find VSCodeVim's module, reaches ModeHandlerMap once
// through the closure of the export getAndUpdateModeHandler with node:inspector (calling no
// VSCodeVim function), then polls plain fields of the active editor's ModeHandler every POLL_MS.
// It handles no key: no `type` command, no command, no keybinding.
const vscode = require("vscode");
const { fieldsOf, toState, handlerFor } = require("./vimstate.js");
const reader = require("./inspect-reader.js");

const POLL_MS = 50;
let latest = null;
let error = null;
// Completed polls since activation, so that a reader can show the adapter polled through a window.
let polls = 0;

function activate(context) {
  let map;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      map ??= await reader.modeHandlerMap();
      const e = vscode.window.activeTextEditor;
      const h = e && handlerFor(map, e.document.uri.toString());
      latest = {
        t: Date.now(),
        uri: e ? e.document.uri.toString() : null,
        state: h ? toState(fieldsOf(h)) : null,
      };
    } catch (err) {
      error = String(err);
    } finally {
      polls += 1;
      busy = false;
    }
  }, POLL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  return {
    latest: () => latest,
    error: () => error,
    polls: () => polls,
    pollMs: POLL_MS,
  };
}

module.exports = { activate, deactivate() {} };
