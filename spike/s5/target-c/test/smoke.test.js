const assert = require("node:assert");
const vscode = require("vscode");

suite("S5 target (c)", () => {
  test("the extension activates in VS Code 1.141.0", async () => {
    const ext = vscode.extensions.getExtension(
      "vim-companion-spike.s5-target-c",
    );
    assert.ok(ext, "extension is installed");
    await ext.activate();
    assert.ok(ext.isActive, "extension is active");
    assert.strictEqual(vscode.version, "1.141.0");
  });
});
