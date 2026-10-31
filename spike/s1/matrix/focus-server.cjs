const { appendFileSync } = require("node:fs");
const { frame, decoder } = require("./lsp-framing.cjs");

let configuration = {
  trial: "unconfigured",
  delayMs: 0,
  actions: 1,
  rename: true,
};
const pending = new Map();
const log = (event) =>
  appendFileSync(
    process.argv[2],
    JSON.stringify({
      time: performance.now(),
      timeOrigin: performance.timeOrigin,
      pid: process.pid,
      ...event,
    }) + "\n",
  );
const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 5 },
};
const respond = (id, result, error) =>
  process.stdout.write(
    frame({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) }),
  );
process.stdin.on(
  "data",
  decoder((message) => {
    const { id, method, params = {} } = message;
    if (method === "$/cancelRequest") {
      const request = pending.get(params.id);
      log({
        type: "cancel",
        id: params.id,
        trial: request?.configuration.trial,
      });
      if (request) {
        clearTimeout(request.timer);
        pending.delete(params.id);
        respond(params.id, null, {
          code: -32800,
          message: "Request cancelled",
        });
      }
      return;
    }
    if (method === "initialize")
      return respond(id, {
        capabilities: {
          textDocumentSync: 1,
          codeActionProvider: true,
          renameProvider: { prepareProvider: true },
          documentFormattingProvider: true,
          hoverProvider: true,
        },
        serverInfo: { name: "S1 isolated provider fixture", version: "1" },
      });
    if (method === "initialized" || method?.startsWith("textDocument/did"))
      return;
    if (method === "shutdown") return respond(id, null);
    if (method === "exit") return process.exit(0);
    if (method === "s1/configure") {
      if (
        ![0, 200].includes(params.delayMs) ||
        ![0, 1, 3].includes(params.actions)
      )
        return respond(id, null, {
          code: -32602,
          message: "Invalid fixture configuration",
        });
      configuration = { ...params };
      log({ type: "configured", configuration });
      return respond(id, {
        pid: process.pid,
        timeOrigin: performance.timeOrigin,
      });
    }
    const accepted = [
      "textDocument/codeAction",
      "textDocument/prepareRename",
      "textDocument/rename",
      "textDocument/formatting",
      "textDocument/hover",
    ];
    if (!accepted.includes(method))
      return respond(id, null, { code: -32601, message: "Unknown method" });
    const positionValid = (value) =>
      value &&
      Number.isInteger(value.line) &&
      value.line >= 0 &&
      Number.isInteger(value.character) &&
      value.character >= 0;
    if (
      typeof params.textDocument?.uri !== "string" ||
      (method === "textDocument/codeAction" &&
        (!positionValid(params.range?.start) ||
          !positionValid(params.range?.end))) ||
      ([
        "textDocument/prepareRename",
        "textDocument/rename",
        "textDocument/hover",
      ].includes(method) &&
        !positionValid(params.position))
    )
      return respond(id, null, {
        code: -32602,
        message: "Invalid LSP document/range/position",
      });
    const request = {
      configuration: { ...configuration },
      started: performance.now(),
    };
    log({
      type: "request",
      id,
      method,
      trial: request.configuration.trial,
      params,
    });
    const finish = () => {
      const remaining =
        request.started + request.configuration.delayMs - performance.now();
      if (remaining > 0) {
        request.timer = setTimeout(finish, Math.ceil(remaining));
        return;
      }
      pending.delete(id);
      const config = request.configuration;
      let result;
      if (method === "textDocument/codeAction")
        result = Array.from({ length: config.actions }, (_, index) => ({
          title: `S1 action ${index + 1}`,
          kind: "quickfix",
          edit: {
            changes: {
              [params.textDocument.uri]: [
                { range, newText: `fixed${index + 1}` },
              ],
            },
          },
        }));
      if (method === "textDocument/prepareRename")
        result = config.rename ? { range, placeholder: "alpha" } : null;
      if (method === "textDocument/rename")
        result = config.rename
          ? {
              changes: {
                [params.textDocument.uri]: [{ range, newText: params.newName }],
              },
            }
          : null;
      if (method === "textDocument/formatting")
        result = [{ range, newText: "ALPHA" }];
      if (method === "textDocument/hover")
        result = {
          contents: { kind: "plaintext", value: "S1 hover for alpha" },
          range,
        };
      log({
        type: "response",
        id,
        method,
        trial: config.trial,
        delayMs: performance.now() - request.started,
      });
      respond(id, result);
    };
    request.timer = setTimeout(finish, request.configuration.delayMs);
    pending.set(id, request);
  }),
);
process.stdin.on("end", () => process.exit(0));
