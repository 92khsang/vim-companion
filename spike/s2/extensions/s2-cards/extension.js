// Spike S2 candidate (b): renders static grammar cards, one per engine state, in a webview view
// with the planned grammar-card markup (<table> with th scope headers). It handles no key. Rows
// carry `when` conditions on VSCodeVim settings; the view shows the rows whose conditions hold for
// the settings in force, read through the configuration API (not VSCodeVim's state).
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");

const SETTINGS = [
  "surround",
  "targets.enable",
  "camelCaseMotion.enable",
  "sneak",
  "replaceWithRegister",
];

function settingsInForce() {
  const c = vscode.workspace.getConfiguration("vim");
  return Object.fromEntries(SETTINGS.map((k) => [`vim.${k}`, c.get(k)]));
}

const holds = (when, s) =>
  !when || Object.entries(when).every(([k, v]) => s[k] === v);

const esc = (t) =>
  String(t).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function render(cards, s) {
  const sections = cards.map((card) => {
    const rows = card.rows
      .filter((r) => holds(r.when, s))
      .map(
        (r) =>
          `<tr data-key="${esc(r.key)}"><th scope="row"><kbd>${esc(r.key)}</kbd></th><td>${esc(r.label ?? "")}</td><td>${r.unsupported ? esc(r.unsupported) : ""}</td></tr>`,
      )
      .join("");
    return `<section class="card" data-card="${esc(card.id)}"><h2>${esc(card.title)}</h2><table><thead><tr><th scope="col">Key</th><th scope="col">Does</th><th scope="col">Unsupported</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>table{border-collapse:collapse}th,td{padding:0 6px;text-align:left}</style></head><body>${sections.join("")}</body></html>`;
}

function activate(context) {
  const cards = JSON.parse(
    fs.readFileSync(path.join(context.extensionPath, "cards.json"), "utf8"),
  );
  let view;
  const refresh = () => {
    if (view) view.webview.html = render(cards, settingsInForce());
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("s2.cards", {
      resolveWebviewView(v) {
        view = v;
        v.webview.options = { enableScripts: false };
        refresh();
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vim")) refresh();
    }),
  );
  return { settingsInForce };
}

module.exports = { activate, deactivate() {} };
