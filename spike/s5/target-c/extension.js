// Spike S5 target (c). A throwaway probe: it reports what VS Code reports, opens a fixture file
// and logs every key that reaches its webview, each only when the matching s5.* setting is set.
const crypto = require("node:crypto");
const fs = require("node:fs");
const vscode = require("vscode");

function setting(key) {
  return vscode.workspace.getConfiguration("s5").get(key) || "";
}

function report(line) {
  const file = setting("report");
  if (file) fs.appendFileSync(file, `${Date.now()}\t${line}\n`);
}

async function activate(context) {
  const config = vscode.workspace.getConfiguration();
  const installed = vscode.extensions.all
    .filter((e) => !e.packageJSON.isBuiltin)
    .map((e) => `${e.id}@${e.packageJSON.version}`)
    .sort();
  report(
    [
      "started",
      `extVersion=${context.extension.packageJSON.version}`,
      `vscode=${vscode.version}`,
      `extensionHostPid=${process.pid}`,
      `update.mode=${config.get("update.mode")}`,
      `extensions.autoUpdate=${config.get("extensions.autoUpdate")}`,
      `extensions.autoCheckUpdates=${config.get("extensions.autoCheckUpdates")}`,
      `installed=${installed.join(",")}`,
    ].join("\t"),
  );
  const fixture = setting("fixture");
  if (fixture) {
    const doc = await vscode.workspace.openTextDocument(fixture);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    });
    report("fixture-opened");
  }
  const keylog = setting("keylog");
  if (keylog) openProbe(context, keylog);
}

function openProbe(context, keylog) {
  const panel = vscode.window.createWebviewPanel(
    "s5probe",
    "S5 key probe",
    { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = crypto.randomBytes(16).toString("hex");
  panel.webview.html = probeHtml(nonce);
  let count = 0;
  panel.webview.onDidReceiveMessage(
    (m) => {
      if (m.type === "key") {
        count += 1;
        fs.appendFileSync(
          keylog,
          `${count}\t${Date.now()}\t${m.name}\t${m.raw}\n`,
        );
      } else if (m.type === "focus") {
        report(`probe-focus\t${m.value}`);
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.reveal(vscode.ViewColumn.Two, false);
  report("probe-opened");
}

function probeHtml(nonce) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
</head><body tabindex="0" style="font: 20px sans-serif">
<h1>S5 key probe</h1><p id="n">0 keys</p>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const modifiers = new Set(["Shift", "Control", "Meta", "Alt", "AltGraph", "CapsLock", "OS", "Super", "Hyper", "Fn"]);
let n = 0;
function describe(e) {
  if (modifiers.has(e.key)) return null;
  let s = "";
  if (e.ctrlKey) s += "Ctrl+";
  if (e.metaKey) s += "Cmd+";
  if (e.altKey) s += "Alt+";
  if (e.shiftKey) s += "Shift+";
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) s += c.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(c)) s += c.slice(5);
  else if (c === "Space" || c === "Escape") s += c;
  else s += "code:" + c;
  return s;
}
window.addEventListener("keydown", (e) => {
  const name = describe(e);
  if (name !== null) {
    n += 1;
    document.getElementById("n").textContent = n + " keys";
    api.postMessage({ type: "key", name, raw: "key=" + e.key + " code=" + e.code + " repeat=" + e.repeat });
  }
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
window.addEventListener("keyup", (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
window.addEventListener("keypress", (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
window.addEventListener("focus", () => api.postMessage({ type: "focus", value: true }));
window.addEventListener("blur", () => api.postMessage({ type: "focus", value: false }));
document.body.focus();
api.postMessage({ type: "focus", value: document.hasFocus() });
</script></body></html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
