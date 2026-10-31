const vscode = require("vscode");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { readFileSync, existsSync } = require("node:fs");
const { frame, decoder } = require("./lsp-framing.cjs");

exports.activate = async (context) => {
  const secondary = context.extension.id.endsWith("s1-focus-secondary");
  const name = secondary ? "secondary" : "primary";
  const serverLog = process.env.S1_SOCKET + "." + name + "-lsp.jsonl";
  const child = spawn(
    process.execPath,
    [join(__dirname, "focus-server.cjs"), serverLog],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const events = [],
    pending = new Map();
  let sequence = 0,
    trial = "initialization",
    stderr = "",
    registrations = [];
  child.stderr.on("data", (bytes) => {
    stderr += bytes.toString();
  });
  const record = (type, details) =>
    events.push({ type, time: performance.now(), trial, ...details });
  const fail = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code, signal) =>
    fail(new Error(`fixture server exited: ${code}/${signal}`)),
  );
  child.stdout.on(
    "data",
    decoder((message) => {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timeout);
      item.cancellation?.dispose();
      record("response", {
        id: message.id,
        method: item.method,
        requestTrial: item.trial,
        error: message.error,
      });
      if (message.error)
        item.reject(
          Object.assign(new Error(message.error.message), {
            code: message.error.code,
          }),
        );
      else item.resolve(message.result);
    }),
  );
  const notify = (method, params) =>
    child.stdin.write(frame({ jsonrpc: "2.0", method, params }));
  const request = (method, params, token) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("fixture request timeout: " + method));
      }, 10000);
      const cancellation = token?.onCancellationRequested(() => {
        record("cancel", { id, method });
        notify("$/cancelRequest", { id });
      });
      pending.set(id, {
        resolve,
        reject,
        method,
        trial,
        timeout,
        cancellation,
      });
      record("request", { id, method });
      child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
      if (token?.isCancellationRequested) notify("$/cancelRequest", { id });
    });
  await request("initialize", {
    processId: process.pid,
    rootUri: vscode.workspace.workspaceFolders?.[0]?.uri.toString(),
    capabilities: {},
  });
  notify("initialized", {});
  const opened = new Set();
  const sync = (document) => {
    const uri = document.uri.toString();
    if (!opened.has(uri)) {
      opened.add(uri);
      notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: document.languageId,
          version: document.version,
          text: document.getText(),
        },
      });
    } else
      notify("textDocument/didChange", {
        textDocument: { uri, version: document.version },
        contentChanges: [{ text: document.getText() }],
      });
    return { uri };
  };
  const range = (value) =>
    new vscode.Range(
      value.start.line,
      value.start.character,
      value.end.line,
      value.end.character,
    );
  const workspaceEdit = (value) => {
    if (!value) return undefined;
    const edit = new vscode.WorkspaceEdit();
    for (const [uri, edits] of Object.entries(value.changes ?? {}))
      edit.set(
        vscode.Uri.parse(uri),
        edits.map(
          (item) => new vscode.TextEdit(range(item.range), item.newText),
        ),
      );
    return edit;
  };
  const guarded = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      if (error.code === -32800) return undefined;
      throw error;
    }
  };
  const selector = { language: "s1-focus", scheme: "file" };
  const configure = async (configuration) => {
    for (const item of registrations) item.dispose();
    registrations = [];
    trial = configuration.trial;
    const metadata = await request("s1/configure", configuration);
    if (secondary && !configuration.secondary) return metadata;
    const register = (value) => registrations.push(value);
    if (!secondary) {
      register(
        vscode.languages.registerCodeActionsProvider(
          selector,
          {
            provideCodeActions: (document, selected, actionContext, token) =>
              guarded(async () => {
                const values = await request(
                  "textDocument/codeAction",
                  {
                    textDocument: sync(document),
                    range: {
                      start: {
                        line: selected.start.line,
                        character: selected.start.character,
                      },
                      end: {
                        line: selected.end.line,
                        character: selected.end.character,
                      },
                    },
                    context: {
                      diagnostics: [],
                      only: actionContext.only
                        ? [actionContext.only.value]
                        : undefined,
                      triggerKind: actionContext.triggerKind,
                    },
                  },
                  token,
                );
                return values.map((value) => {
                  const action = new vscode.CodeAction(
                    value.title,
                    vscode.CodeActionKind.QuickFix,
                  );
                  action.edit = workspaceEdit(value.edit);
                  return action;
                });
              }),
          },
          { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
        ),
      );
      register(
        vscode.languages.registerRenameProvider(selector, {
          prepareRename: (document, position, token) =>
            guarded(async () => {
              const value = await request(
                "textDocument/prepareRename",
                { textDocument: sync(document), position },
                token,
              );
              if (!value)
                throw new Error("This fixture symbol cannot be renamed");
              return {
                range: range(value.range),
                placeholder: value.placeholder,
              };
            }),
          provideRenameEdits: (document, position, newName, token) =>
            guarded(async () =>
              workspaceEdit(
                await request(
                  "textDocument/rename",
                  { textDocument: sync(document), position, newName },
                  token,
                ),
              ),
            ),
        }),
      );
      register(
        vscode.languages.registerHoverProvider(selector, {
          provideHover: (document, position, token) =>
            guarded(async () => {
              const value = await request(
                "textDocument/hover",
                { textDocument: sync(document), position },
                token,
              );
              return value
                ? new vscode.Hover(value.contents.value, range(value.range))
                : undefined;
            }),
        }),
      );
    }
    register(
      vscode.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: (document, options, token) =>
          guarded(async () =>
            (
              await request(
                "textDocument/formatting",
                { textDocument: sync(document), options },
                token,
              )
            ).map(
              (value) => new vscode.TextEdit(range(value.range), value.newText),
            ),
          ),
      }),
    );
    return {
      ...metadata,
      extensionId: context.extension.id,
      hostPid: process.pid,
    };
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "s1.focus." + name + ".configure",
      configure,
    ),
    vscode.commands.registerCommand("s1.focus." + name + ".events", () => ({
      events: [...events],
      server: existsSync(serverLog)
        ? readFileSync(serverLog, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse)
        : [],
      stderr,
      pid: process.pid,
      timeOrigin: performance.timeOrigin,
      serverPid: child.pid,
    })),
    {
      dispose() {
        for (const item of registrations) item.dispose();
        child.stdin.end();
        child.kill("SIGTERM");
      },
    },
  );
  return { pid: process.pid, serverPid: child.pid };
};
