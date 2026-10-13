// The throwaway extension that pnpm ids:refresh vscode runs in a temporary VS Code: it activates
// the extensions in $VIM_COMPANION_IDS_ACTIVATE (comma-separated), writes every command ID to
// $VIM_COMPANION_IDS_OUT and quits VS Code. CommonJS: this directory's package.json has no "type".
const vscode = require("vscode");
const fs = require("node:fs");

exports.activate = async () => {
  const out = process.env.VIM_COMPANION_IDS_OUT;
  if (!out) return;
  try {
    const wanted = (process.env.VIM_COMPANION_IDS_ACTIVATE ?? "")
      .split(",")
      .filter(Boolean);
    const activated = [];
    for (const id of wanted) {
      const ext = vscode.extensions.getExtension(id);
      if (!ext) continue;
      try {
        await ext.activate();
        activated.push(`${ext.id}@${ext.packageJSON.version}`);
      } catch (error) {
        // ids:refresh reports the extensions that are missing from `activated`.
        console.error(`vim-companion-ids-dump: ${id}: ${error}`);
      }
    }
    const commands = [
      ...new Set(await vscode.commands.getCommands(true)),
    ].sort();
    fs.writeFileSync(
      out,
      JSON.stringify({ vscode: vscode.version, activated, commands }, null, 2) +
        "\n",
    );
  } finally {
    await vscode.commands.executeCommand("workbench.action.quit");
  }
};
