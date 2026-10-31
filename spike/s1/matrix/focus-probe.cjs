const { join, dirname } = require("node:path");
const { writeFileSync, existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");

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
      await vscode.workspace.saveAll(false);
      await execute("workbench.action.closeAllEditors");
      await execute("workbench.action.joinAllGroups");
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
      for (const file of [...files, outside]) writeFileSync(file, fixtureText);
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
      return {
        ...state(),
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
