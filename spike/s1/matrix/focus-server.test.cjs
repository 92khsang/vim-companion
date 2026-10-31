const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { frame, decoder } = require("./lsp-framing.cjs");

test("LSP framing preserves split UTF-8 messages and rejects ambiguous lengths", () => {
  const messages = [],
    receive = decoder((value) => messages.push(value));
  const values = [{ text: "한글" }, { id: 2 }];
  for (const byte of Buffer.concat(values.map(frame)))
    receive(Buffer.from([byte]));
  assert.deepEqual(messages, values);
  assert.throws(
    () =>
      decoder(() => {})(
        Buffer.from("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}"),
      ),
    /duplicated/,
  );
});

test("separate language server delays prepareRename and honours cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "s1-focus-server-test-"));
  const log = join(root, "events.jsonl");
  const child = spawn(process.execPath, [
    join(__dirname, "focus-server.cjs"),
    log,
  ]);
  const pending = new Map();
  child.stdout.on(
    "data",
    decoder((message) => pending.get(message.id)?.(message)),
  );
  const request = (id, method, params) =>
    new Promise((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
    });
  try {
    await request(1, "initialize", {});
    await request(2, "s1/configure", {
      trial: "test",
      delayMs: 200,
      actions: 1,
      rename: true,
    });
    const started = performance.now();
    const value = await request(3, "textDocument/prepareRename", {
      textDocument: { uri: "file:///fixture.s1focus" },
      position: { line: 0, character: 0 },
    });
    assert.ok(performance.now() - started >= 200);
    assert.equal(value.result.placeholder, "alpha");
    const cancelStarted = performance.now();
    const cancelled = request(4, "textDocument/hover", {
      textDocument: { uri: "file:///fixture.s1focus" },
      position: { line: 0, character: 0 },
    });
    child.stdin.write(
      frame({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 4 } }),
    );
    assert.equal((await cancelled).error.code, -32800);
    assert.ok(performance.now() - cancelStarted >= 200);
    assert.equal(
      (
        await request(5, "textDocument/codeAction", {
          textDocument: { uri: "file:///fixture.s1focus" },
          range: [
            { line: 0, character: 0 },
            { line: 0, character: 1 },
          ],
        })
      ).error.code,
      -32602,
    );
    const events = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(
      events.find(
        (event) =>
          event.type === "response" &&
          event.method === "textDocument/prepareRename",
      ).delayMs >= 200,
    );
    assert.equal(
      events.filter((event) => event.type === "response" && event.id === 4)
        .length,
      0,
    );
    assert.ok(
      events.find(
        (event) => event.type === "cancelled-response" && event.id === 4,
      ).delayMs >= 200,
    );
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(root, { recursive: true });
  }
});
