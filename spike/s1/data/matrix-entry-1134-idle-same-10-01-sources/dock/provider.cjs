const { randomBytes } = require("node:crypto");
const { createDockModel } = require("./model.cjs");

exports.createDock = (vscode, context) => {
  const model = createDockModel();
  let view = null;
  let generation = 0;
  let instance = null;
  let ready = false;
  let resolutions = 0;
  const retired = new Set();
  const subscriptions = [];
  const events = [];
  const violations = [];
  const record = (type, extra = {}) =>
    events.push({ t: performance.now(), type, ...extra });
  const attach = () => {
    if (ready && view?.visible)
      model.attach(instance, (message) => view.webview.postMessage(message));
  };
  subscriptions.push(
    vscode.window.registerWebviewViewProvider("s1.dock", {
      resolveWebviewView(next) {
        if (instance) model.detach(instance);
        view = next;
        const id = ++generation;
        instance = null;
        resolutions += 1;
        ready = false;
        view.webview.options = {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dock", "web"),
          ],
        };
        subscriptions.push(
          view.webview.onDidReceiveMessage((message) => {
            if (
              generation !== id ||
              typeof message.instance !== "string" ||
              !message.instance.startsWith(id + ":") ||
              retired.has(message.instance)
            )
              return;
            if (message.type === "s1-ready" && next.visible) {
              if (instance && instance !== message.instance) {
                retired.add(instance);
                model.detach(instance);
              }
              instance = message.instance;
              ready = true;
              record("ready", { instance });
              attach();
            }
            if (message.instance !== instance) return;
            if (message.type === "s1-applied") model.receive(message);
            if (message.type === "s1-csp") violations.push(message.violation);
          }),
        );
        subscriptions.push(
          view.onDidChangeVisibility(() => {
            if (generation !== id) return;
            record("visibility", { visible: next.visible, instance: id });
            if (next.visible) attach();
            else {
              model.detach(instance);
              if (instance) retired.add(instance);
              ready = false;
              instance = null;
            }
          }),
        );
        subscriptions.push(
          view.onDidDispose(() => {
            if (generation !== id) return;
            model.detach(instance);
            if (instance) retired.add(instance);
            view = null;
            instance = null;
            ready = false;
            record("disposed", { instance: id });
          }),
        );
        const nonce = randomBytes(18).toString("hex");
        const asset = (name) =>
          next.webview
            .asWebviewUri(
              vscode.Uri.joinPath(context.extensionUri, "dock", "web", name),
            )
            .toString();
        next.webview.html = `<!doctype html><html lang="en" data-host="sidebar"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${next.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset("styles.css")}">
<script nonce="${nonce}" src="${asset("reference.js")}" defer></script>
<script nonce="${nonce}" src="${asset("state.js")}" defer></script>
<script nonce="${nonce}" src="${asset("renderer.js")}" defer></script>
<title>Vim Keys</title></head><body data-instance="${id}"><main id="keys" aria-label="Vim Keys"></main></body></html>`;
        record("resolved", { instance: id });
      },
    }),
  );
  return {
    model,
    snapshot: () => ({
      ...model.snapshot(),
      visible: view?.visible ?? false,
      resolutions,
      ready,
      violations: [...violations],
      events: [...events],
    }),
    // Called only by the sandbox probe between measured input sequences.
    async control({ action, tab, topic }) {
      record("control", { action, tab, topic });
      if (action === "show") {
        await vscode.commands.executeCommand("s1.dock.focus");
      } else if (action === "hide") {
        await vscode.commands.executeCommand(
          "workbench.action.closeAuxiliaryBar",
        );
      } else if (action === "select") {
        if (!view?.visible || !ready)
          throw new Error("dock must be ready and visible");
        await view.webview.postMessage({
          type: "s1-select",
          instance,
          tab,
          topic,
        });
      } else throw new Error("unknown dock control");
      await vscode.commands.executeCommand(
        "workbench.action.focusActiveEditorGroup",
      );
      return true;
    },
    dispose() {
      model.dispose();
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
};
