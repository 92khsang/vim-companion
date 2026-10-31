import assert from "node:assert/strict";

// Extend only the throwaway leaf dispatcher. Entry/cancel/watchdog/cleanup keep
// the retained prototype's code. Tests compare those regions byte for byte.
export function extendedLeader(source) {
  const header = 'const vscode = require("vscode");';
  assert.equal(source.split(header).length, 2);
  source = source.replace(
    header,
    header + '\nconst matrixLeaves = require("./matrix-catalog.json").leaves;',
  );
  const start = source.indexOf('  if (prefix.join(" ") === "w") return;');
  const end = source.indexOf("\n}\n\nexports.activate", start);
  assert.ok(start > 0 && end > start);
  return (
    source.slice(0, start) +
    `  const leaves = matrixLeaves;
  const current = prefix.join(" ");
  const leaf = leaves.find((item) => item.keys.join(" ") === current);
  if (!leaf && leaves.some((item) => item.keys.join(" ").startsWith(current + " "))) return;
  if (!leaf) {
    await end("undefined-key");
    return;
  }
  try {
    if (leaf.exit === "editor") await end("leaf");
    record("leaf-start", { command: leaf.exec.command, id: leaf.id });
    await vscode.commands.executeCommand(leaf.exec.command, ...(leaf.exec.args === undefined ? [] : [leaf.exec.args]));
    record("leaf-end", { id: leaf.id });
  } catch (error) {
    record("leaf-error", { id: leaf.id, error: String(error) });
    throw error;
  } finally {
    await end("leaf-finally");
  }` +
    source.slice(end)
  );
}

export function extendedProbe(source) {
  source = source.replace(
    "    viewColumn: e?.viewColumn ?? null,",
    "    documentUri: e?.document.uri.toString() ?? null,\n    selectedText: e?.selections.map((selection) => e.document.getText(selection)) ?? [],\n    viewColumn: e?.viewColumn ?? null,",
  );
  const before = "  const methods = {";
  assert.equal(source.split(before).length, 2);
  return source.replace(
    before,
    `  const methods = {
    command: async ({command, args = []}) => {
      await vscode.commands.executeCommand(command, ...args);
      return true;
    },
    clearLeader: async () => { await leader?.clearEvents(); return true; },
    editors: () => vscode.window.tabGroups.all.map((group) => ({
      column: group.viewColumn,
      active: group.isActive,
      tabs: group.tabs.map((tab) => ({ label: tab.label, active: tab.isActive, dirty: tab.isDirty, uri: tab.input?.uri?.toString() })),
    })),
    position: async ({line = 0, character = 0}) => {
      const p = new vscode.Position(line, character);
      vscode.window.activeTextEditor.selection = new vscode.Selection(p, p);
      return true;
    },
    openTab: async ({file, column = 2}) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(document, {viewColumn: column, preview: false});
      return true;
    },`,
  );
}
