const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const {
  discardFixtureEditors,
  resetFixtureFiles,
} = require("./focus-probe.cjs");

test("fixture discard closes dirty owned tabs without saving and refuses foreign files", async () => {
  const document = { isDirty: true, isClosed: false };
  const tabs = ["alpha", "beta"].map((name) => ({
    input: { uri: { scheme: "file", fsPath: "/private/workspace/" + name } },
  }));
  const vscode = {
    window: { tabGroups: { all: [{ tabs }] } },
    workspace: { textDocuments: [document] },
  };
  const commands = [];
  const execute = async (command) => {
    commands.push(command);
    if (command === "workbench.action.revertAndCloseActiveEditor") {
      tabs.pop();
      document.isDirty = false;
    }
  };
  assert.deepEqual(
    await discardFixtureEditors(vscode, execute, "/private/workspace"),
    {
      discardedTabs: 2,
      remainingTabs: 0,
    },
  );
  assert.deepEqual(commands, [
    "workbench.action.joinAllGroups",
    "workbench.action.revertAndCloseActiveEditor",
    "workbench.action.revertAndCloseActiveEditor",
  ]);
  tabs.push({ input: { uri: { scheme: "file", fsPath: "/different/file" } } });
  await assert.rejects(
    discardFixtureEditors(vscode, execute, "/private/workspace"),
    /outside the disposable fixture/,
  );
  assert.equal(commands.length, 3);
});

test("fixture reset edits the cached model, checks save results and preserves disk agreement", async () => {
  const root = mkdtempSync(join(tmpdir(), "s1-focus-reset-test-")),
    file = join(root, "alpha.s1focus");
  try {
    const baseline = "alpha beta\n";
    writeFileSync(file, baseline);
    const uri = { fsPath: file, toString: () => "file:" + file };
    let allowSave = true,
      allowEdit = true;
    const document = {
      uri,
      text: "dirty dirty " + baseline,
      isDirty: true,
      version: 1,
      getText() {
        return this.text;
      },
      positionAt(value) {
        return value;
      },
      async save() {
        if (!allowSave) return false;
        writeFileSync(file, this.text);
        this.isDirty = false;
        return true;
      },
    };
    const vscode = {
      Uri: { file: () => uri },
      Range: class {
        constructor(start, end) {
          this.start = start;
          this.end = end;
        }
      },
      WorkspaceEdit: class {
        replace(uri, range, text) {
          this.text = text;
        }
      },
      workspace: {
        openTextDocument: async () => document,
        applyEdit: async (edit) => {
          assert.equal(readFileSync(file, "utf8"), baseline);
          if (!allowEdit) return false;
          document.text = edit.text;
          document.isDirty = true;
          document.version++;
          return true;
        },
      },
    };
    const result = await resetFixtureFiles(vscode, [file], baseline);
    assert.equal(result[0].text, baseline);
    assert.equal(document.isDirty, false);
    assert.equal(readFileSync(file, "utf8"), baseline);
    document.text = "dirty " + baseline;
    document.isDirty = true;
    await resetFixtureFiles(vscode, [file], baseline);
    assert.equal(document.text, baseline);
    document.text = "dirty " + baseline;
    allowEdit = false;
    await assert.rejects(
      resetFixtureFiles(vscode, [file], baseline),
      /document reset failed/,
    );
    assert.equal(readFileSync(file, "utf8"), baseline);
    allowEdit = true;
    allowSave = false;
    await assert.rejects(
      resetFixtureFiles(vscode, [file], baseline),
      /baseline could not be saved/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean fixture baselines need no save while dirty saves and disk agreement remain mandatory", async () => {
  const root = mkdtempSync(join(tmpdir(), "s1-focus-clean-test-")),
    file = join(root, "alpha.s1focus");
  try {
    const baseline = "alpha beta\n";
    writeFileSync(file, baseline);
    const uri = { fsPath: file, toString: () => "file:" + file };
    let saveCalls = 0;
    const document = {
      uri,
      isDirty: false,
      isClosed: false,
      version: 1,
      getText: () => baseline,
      async save() {
        saveCalls++;
        return false;
      },
    };
    const vscode = {
      Uri: { file: () => uri },
      workspace: { openTextDocument: async () => document },
    };
    assert.deepEqual(await resetFixtureFiles(vscode, [file], baseline), [
      { uri: uri.toString(), version: 1, text: baseline, dirty: false },
    ]);
    assert.equal(saveCalls, 0);
    writeFileSync(file, "different disk content\n");
    await assert.rejects(
      resetFixtureFiles(vscode, [file], baseline),
      /disk differs from baseline/,
    );
    assert.equal(saveCalls, 0);
    writeFileSync(file, baseline);
    document.isDirty = true;
    await assert.rejects(
      resetFixtureFiles(vscode, [file], baseline),
      /baseline could not be saved/,
    );
    assert.equal(saveCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
