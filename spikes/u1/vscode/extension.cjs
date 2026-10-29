const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { page } = require("./page.cjs");

exports.activate = (context) => {
  const captureHost = process.env.U1_CAPTURE_HOST ?? "sidebar";
  const viewId = captureHost === "panel" ? "u1.panel" : "u1.keys";
  let view;
  let state = "idle";
  let requestId;
  const render = () => {
    if (!view) return;
    view.webview.html = page(
      (name) =>
        view.webview
          .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "web", name))
          .toString(),
      state,
      view.webview.cspSource,
      null,
      captureHost,
    );
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(viewId, {
      resolveWebviewView(next) {
        view = next;
        view.webview.options = {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "web"),
          ],
        };
        context.subscriptions.push(
          view.webview.onDidReceiveMessage(async (message) => {
            if (message.type === "u1-theme" && process.env.U1_CONTEXT_DIR) {
              const editors = vscode.window.visibleTextEditors;
              fs.writeFileSync(
                path.join(process.env.U1_CONTEXT_DIR, "ready.json"),
                JSON.stringify({
                  id: requestId,
                  vscode: vscode.version,
                  state: message.capture.state,
                  viewport: message.capture.viewport,
                  deviceScaleFactor: message.capture.deviceScaleFactor,
                  viewVisible: view.visible,
                  editorGroups: editors.map((editor) => ({
                    file: path.basename(editor.document.fileName),
                    column: editor.viewColumn,
                  })),
                }),
              );
              return;
            }
            if (message.type !== "u1-theme" || !process.env.U1_CAPTURE_DIR)
              return;
            const file = path.join(
              process.env.U1_CAPTURE_DIR,
              process.env.U1_CAPTURE_FILE ?? "vscode-theme.json",
            );
            fs.writeFileSync(
              file,
              JSON.stringify(
                {
                  vscode: vscode.version,
                  theme: vscode.workspace
                    .getConfiguration("workbench")
                    .get("colorTheme"),
                  ...message.capture,
                },
                null,
                2,
              ) + "\n",
            );
            await vscode.commands.executeCommand("workbench.action.quit");
          }),
        );
        render();
      },
    }),
  );
  for (const next of [
    "idle",
    "prefix",
    "badges",
    "grammar",
    ...Object.keys(require("../vim-learning.json").scenarios),
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`u1.${next}`, async () => {
        if (next.startsWith("vim-") && view) {
          void view.webview.postMessage({ type: "u1-context", state: next });
          state = next;
        } else {
          state = next;
          render();
        }
      }),
    );
  }
  // Only the sandbox capture opts into revealing the view on startup.
  if (process.env.U1_CAPTURE_DIR) {
    void vscode.commands.executeCommand(`${viewId}.focus`);
  }
  if (process.env.U1_CONTEXT_DIR) {
    // The capture driver selects fixed states without installing key handlers.
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      const file = path.join(process.env.U1_CONTEXT_DIR, "request.json");
      if (!fs.existsSync(file)) return;
      const request = JSON.parse(fs.readFileSync(file, "utf8"));
      if (request.id === requestId) return;
      busy = true;
      try {
        requestId = request.id;
        state = request.state;
        await vscode.commands.executeCommand("workbench.action.closeSidebar");
        await vscode.commands.executeCommand(
          request.split
            ? "workbench.action.editorLayoutTwoColumns"
            : "workbench.action.editorLayoutSingle",
        );
        const folder = vscode.workspace.workspaceFolders[0].uri;
        await vscode.window.showTextDocument(
          vscode.Uri.joinPath(folder, "OrderService.java"),
          { viewColumn: vscode.ViewColumn.One, preview: false },
        );
        if (request.split) {
          await vscode.window.showTextDocument(
            vscode.Uri.joinPath(folder, "Order.java"),
            { viewColumn: vscode.ViewColumn.Two, preview: false },
          );
        }
        if (!view) await vscode.commands.executeCommand("u1.keys.focus");
        await vscode.commands.executeCommand(
          "workbench.action.focusActiveEditorGroup",
        );
        if (request.hidden) {
          await vscode.commands.executeCommand(
            "workbench.action.closeAuxiliaryBar",
          );
        }
        render();
        if (request.hidden) {
          fs.writeFileSync(
            path.join(process.env.U1_CONTEXT_DIR, "ready.json"),
            JSON.stringify({
              id: requestId,
              vscode: vscode.version,
              state,
              viewVisible: view.visible,
              editorGroups: vscode.window.visibleTextEditors.map((editor) => ({
                file: path.basename(editor.document.fileName),
                column: editor.viewColumn,
              })),
            }),
          );
        }
      } catch (error) {
        fs.writeFileSync(
          path.join(process.env.U1_CONTEXT_DIR, "error.txt"),
          String(error),
        );
      } finally {
        busy = false;
      }
    }, 100);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }
};
