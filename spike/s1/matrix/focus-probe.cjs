const { join, dirname } = require("node:path");
const { writeFileSync, readFileSync, existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");

exports.discardFixtureEditors = async (vscode, execute, workspace) => {
  const outside = join(dirname(workspace), "outside.s1focus");
  for (const group of vscode.window.tabGroups.all)
    for (const tab of group.tabs) {
      const uri = tab.input?.uri;
      assert.ok(
        uri &&
          (uri.scheme === "untitled" ||
            (uri.scheme === "file" &&
              (uri.fsPath.startsWith(workspace + "/") ||
                uri.fsPath === outside))),
        "refusing to discard an editor outside the disposable fixture",
      );
    }
  await execute("workbench.action.joinAllGroups");
  const count = () =>
    vscode.window.tabGroups.all.reduce(
      (sum, group) => sum + group.tabs.length,
      0,
    );
  const initial = count();
  while (count()) {
    const before = count();
    await execute("workbench.action.revertAndCloseActiveEditor");
    const deadline = performance.now() + 5000;
    while (count() >= before && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(count() < before, "fixture editor did not close after revert");
  }
  assert.ok(
    !vscode.workspace.textDocuments.some(
      (document) => !document.isClosed && document.isDirty,
    ),
    "a dirty document survived fixture discard",
  );
  return { discardedTabs: initial, remainingTabs: count() };
};

exports.resetFixtureFiles = async (vscode, files, fixtureText) => {
  const records = [];
  for (const file of files) {
    if (!existsSync(file)) writeFileSync(file, fixtureText);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.getText() !== fixtureText) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
        fixtureText,
      );
      assert.equal(
        await vscode.workspace.applyEdit(edit),
        true,
        "fixture document reset failed",
      );
    }
    assert.equal(
      await document.save(),
      true,
      "fixture baseline could not be saved",
    );
    assert.equal(
      document.isDirty,
      false,
      "saved fixture baseline remains dirty",
    );
    assert.equal(
      document.getText(),
      fixtureText,
      "fixture model differs from baseline",
    );
    assert.equal(
      readFileSync(file, "utf8"),
      fixtureText,
      "fixture disk differs from baseline",
    );
    records.push({
      uri: uri.toString(),
      version: document.version,
      text: document.getText(),
      dirty: document.isDirty,
    });
  }
  return records;
};

exports.createFocusProbe = (vscode, context) => {
  let sentinel = null,
    sequence = 0;
  context.subscriptions.push(
    vscode.commands.registerCommand("s1.focus.sentinel", (value) => {
      sentinel = { ...value, sequence: ++sequence, time: performance.now() };
    }),
  );
  const execute = (command, ...args) =>
    vscode.commands.executeCommand(command, ...args);
  const settings = async (values) => {
    for (const [key, value] of Object.entries(values)) {
      const configuration = vscode.workspace.getConfiguration();
      if (JSON.stringify(configuration.get(key)) !== JSON.stringify(value))
        await configuration.update(
          key,
          value,
          vscode.ConfigurationTarget.Global,
        );
    }
  };
  const state = () => ({
    time: performance.now(),
    timeOrigin: performance.timeOrigin,
    sentinel,
    active: vscode.window.activeTextEditor && {
      uri: vscode.window.activeTextEditor.document.uri.toString(),
      column: vscode.window.activeTextEditor.viewColumn,
      text: vscode.window.activeTextEditor.document.getText(),
      dirty: vscode.window.activeTextEditor.document.isDirty,
      selections: vscode.window.activeTextEditor.selections.map((value) => [
        value.anchor.line,
        value.anchor.character,
        value.active.line,
        value.active.character,
      ]),
    },
    groups: vscode.window.tabGroups.all.map((group) => ({
      column: group.viewColumn,
      active: group.isActive,
      tabs: group.tabs.map((tab) => ({
        label: tab.label,
        dirty: tab.isDirty,
        active: tab.isActive,
        uri: tab.input?.uri?.toString(),
      })),
    })),
  });
  const show = async (file, column = 1) => {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(file),
    );
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: column,
      preview: false,
    });
    const p = new vscode.Position(0, 0);
    editor.selection = new vscode.Selection(p, p);
    return editor;
  };
  return {
    state,
    async setup({ scenario, trial, workspace, fixtureText }) {
      await execute("vimCompanion.resetInputState");
      const reset = await exports.discardFixtureEditors(
        vscode,
        execute,
        workspace,
      );
      const chosen = {
        "files.autoSave": "off",
        "editor.accessibilitySupport":
          scenario.state === "accessible" ? "on" : "off",
        "editor.hover.enabled": true,
        "editor.lightbulb.enabled": "off",
        "editor.codeActionsOnSave": {},
        "editor.defaultFormatter": scenario.state.startsWith("unavailable")
          ? "vscode.git"
          : null,
        "explorer.openEditors.visible":
          scenario.state === "outside-visible" ? 9 : 0,
        "scm.autoReveal": scenario.state === "resource-focused",
      };
      await settings(chosen);
      const effectiveSettings = Object.fromEntries(
        Object.keys(chosen).map((key) => [
          key,
          vscode.workspace.getConfiguration().get(key),
        ]),
      );
      for (const [key, value] of Object.entries(chosen))
        if (JSON.stringify(effectiveSettings[key]) !== JSON.stringify(value))
          throw new Error("effective fixture configuration differs: " + key);
      const files = ["alpha.s1focus", "beta.s1focus", "gamma.s1focus"].map(
        (name) => join(workspace, name),
      );
      const outside = join(dirname(workspace), "outside.s1focus");
      const baselines = await exports.resetFixtureFiles(
        vscode,
        [...files, outside],
        fixtureText,
      );
      const providerConfig = {
        trial,
        delayMs: scenario.delayed ? 200 : 0,
        actions:
          scenario.state === "none" ? 0 : scenario.state === "many" ? 3 : 1,
        rename: scenario.state !== "rejected",
        secondary: scenario.state.startsWith("multiple"),
      };
      const providers = [];
      for (const name of ["primary", "secondary"]) {
        await vscode.extensions
          .getExtension("vim-companion-spike.s1-focus-" + name)
          .activate();
        providers.push(
          await execute("s1.focus." + name + ".configure", providerConfig),
        );
      }
      const keys = scenario.leaf.keys.join(" ");
      let active, dirtyFile;
      if (keys.startsWith("w ") && !["w v", "w s"].includes(keys)) {
        await execute(
          ["w j", "w k"].includes(keys)
            ? "workbench.action.editorLayoutTwoRows"
            : "workbench.action.editorLayoutTwoColumns",
        );
        await show(files[0], 1);
        await show(files[1], 2);
        const column = ["w l", "w j", "w w", "w o"].includes(keys) ? 1 : 2;
        active = files[column - 1];
        if (scenario.state === "dirty")
          dirtyFile = keys === "w o" ? files[1] : active;
        if (dirtyFile) {
          const dirtyEditor = await show(
            dirtyFile,
            dirtyFile === files[0] ? 1 : 2,
          );
          await dirtyEditor.edit((edit) =>
            edit.insert(new vscode.Position(0, 0), "dirty "),
          );
        }
        await show(active, column);
      } else {
        for (const file of files) await show(file);
        if (keys === "b u") await execute("workbench.action.closeActiveEditor");
        active = scenario.state.startsWith("outside")
          ? outside
          : files[keys === "b p" ? 2 : 0];
        if (scenario.state === "dirty")
          dirtyFile = keys === "b o" ? files[1] : active;
        if (dirtyFile) {
          const dirtyEditor = await show(dirtyFile);
          await dirtyEditor.edit((edit) =>
            edit.insert(new vscode.Position(0, 0), "dirty "),
          );
        }
        await show(active);
      }
      let repository;
      if (keys === "g g") {
        const git = await vscode.extensions
          .getExtension("vscode.git")
          .activate();
        const api = git.getAPI(1);
        if (scenario.state === "no-repository") {
          if (api.repositories.length || existsSync(join(workspace, ".git")))
            throw new Error("no-repository fixture is not empty");
        } else {
          if (!existsSync(join(workspace, ".git")))
            execFileSync("git", ["init", "--quiet", workspace]);
          repository = await api.openRepository(vscode.Uri.file(workspace));
          if (!repository)
            throw new Error("fixture Git repository was not opened");
          if (scenario.state === "resource-focused")
            writeFileSync(
              join(workspace, "scm-change.txt"),
              "S1 SCM fixture\n",
            );
          await repository.status();
        }
      }
      if (scenario.state === "visible")
        await execute("editor.action.showHover");
      const documents = [];
      for (const file of [...files, outside]) {
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(file),
        );
        const expectedDirty = file === dirtyFile;
        assert.equal(
          document.isDirty,
          expectedDirty,
          "fixture dirty state differs",
        );
        assert.equal(
          document.getText(),
          (expectedDirty ? "dirty " : "") + fixtureText,
          "fixture text differs before measured keys",
        );
        assert.equal(
          readFileSync(file, "utf8"),
          fixtureText,
          "fixture disk changed before measured keys",
        );
        documents.push({
          uri: document.uri.toString(),
          text: document.getText(),
          dirty: document.isDirty,
          version: document.version,
        });
      }
      return {
        ...state(),
        reset,
        baselines,
        documents,
        active,
        dirtyFile,
        settings: chosen,
        effectiveSettings,
        providers,
        repository: repository?.rootUri.toString(),
        needsScmRowFocus: scenario.state === "resource-focused",
      };
    },
    async providers() {
      return Object.fromEntries(
        await Promise.all(
          ["primary", "secondary"].map(async (name) => [
            name,
            await execute("s1.focus." + name + ".events"),
          ]),
        ),
      );
    },
  };
};
