const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { page } = require("./page.cjs");

exports.activate = (context) => {
  let view;
  let state = "idle";
  const render = () => {
    if (!view) return;
    view.webview.html = page(
      (name) =>
        view.webview
          .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "web", name))
          .toString(),
      state,
      view.webview.cspSource,
    );
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("u1.keys", {
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
            if (message.type !== "u1-theme" || !process.env.U1_CAPTURE_DIR)
              return;
            const file = path.join(
              process.env.U1_CAPTURE_DIR,
              "vscode-theme.json",
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
  for (const next of ["idle", "prefix", "badges", "grammar"]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`u1.${next}`, async () => {
        state = next;
        await vscode.commands.executeCommand("u1.keys.focus");
        render();
      }),
    );
  }
  // Only the sandbox capture opts into revealing the view on startup.
  if (process.env.U1_CAPTURE_DIR) {
    void vscode.commands.executeCommand("u1.keys.focus");
  }
};
