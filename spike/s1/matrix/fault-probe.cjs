exports.createFaultProbe = (vscode, context) => {
  let configuration;
  let events = [];
  const record = (type, details = {}) => {
    if (configuration)
      events.push({ type, time: performance.now(), ...details });
  };
  const uri = (editor) => editor?.document.uri.toString() ?? null;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        configuration &&
        event.document.uri.toString() === configuration.entryUri &&
        event.contentChanges.length
      )
        record("document-effect", {
          uri: event.document.uri.toString(),
          version: event.document.version,
          text: event.document.getText(),
        });
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      record("editor-effect", { uri: uri(editor) }),
    ),
    vscode.window.onDidChangeTextEditorSelection((event) =>
      record("selection-effect", {
        uri: uri(event.textEditor),
        kind: event.kind,
        selections: event.selections.map((s) => [
          s.anchor.line,
          s.anchor.character,
          s.active.line,
          s.active.character,
        ]),
      }),
    ),
    vscode.window.onDidChangeWindowState((state) =>
      record("window-effect", { focused: state.focused }),
    ),
  );
  return {
    setup(value) {
      configuration = value;
      events = [];
      return { timeOrigin: performance.timeOrigin };
    },
    snapshot() {
      return { timeOrigin: performance.timeOrigin, events: [...events] };
    },
    async action({ kind }) {
      if (!configuration) throw new Error("fault fixture is not configured");
      const started = performance.now();
      record("action-start", { kind });
      if (kind === "document") {
        const editor = vscode.window.activeTextEditor;
        if (uri(editor) !== configuration.entryUri)
          throw new Error("fault document differs from entry");
        const ok = await editor.edit((edit) =>
          edit.insert(
            editor.document.positionAt(editor.document.getText().length),
            "fault-marker",
          ),
        );
        if (!ok) throw new Error("fault edit was rejected");
      } else if (kind === "editor") {
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(configuration.target),
        );
        await vscode.window.showTextDocument(document, {
          viewColumn: 1,
          preview: false,
        });
      } else if (kind === "reset")
        await vscode.commands.executeCommand("vimCompanion.resetInputState");
      else throw new Error("unknown API fault");
      const completed = performance.now();
      record("action-completed", { kind });
      return {
        started,
        completed,
        timeOrigin: performance.timeOrigin,
        activeUri: uri(vscode.window.activeTextEditor),
      };
    },
  };
};
