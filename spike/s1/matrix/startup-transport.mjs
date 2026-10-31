import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export async function connectStartup(
  base,
  { previousPid, check = () => {}, timeoutMs = 60000 } = {},
) {
  const deadline = performance.now() + timeoutMs;
  let record, socket;
  while (performance.now() < deadline) {
    check();
    try {
      record = JSON.parse(readFileSync(base + ".ready.json"));
      assert.ok(
        Number.isSafeInteger(record.pid) &&
          record.pid > 1 &&
          record.pid !== previousPid,
      );
      assert.equal(record.socketPath, base + "." + record.pid + ".sock");
      socket = await new Promise((resolve, reject) => {
        const connection = net.createConnection(record.socketPath);
        connection.once("connect", () => resolve(connection));
        connection.once("error", (error) => {
          connection.destroy();
          reject(error);
        });
      });
      break;
    } catch {
      await sleep(10);
    }
  }
  assert.ok(socket, "new passive startup probe did not connect");
  let sequence = 0,
    pending,
    buffer = "",
    closed = false;
  const fail = (error) => {
    closed = true;
    pending?.reject(error);
    pending = undefined;
  };
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"),
        line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line);
        if (pending?.id !== message.id)
          throw new Error("startup reply belongs to another request/epoch");
        message.error
          ? pending.reject(new Error(message.error))
          : pending.resolve(message.result);
      } catch (error) {
        fail(error);
        socket.destroy();
      }
    }
  });
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("startup probe connection closed")));
  return {
    record,
    call(method, params = {}) {
      check();
      assert.ok(!closed && !pending, "startup probe is closed or busy");
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error("startup RPC timeout: " + method));
          socket.destroy();
        }, 15000);
        pending = {
          id,
          resolve: (value) => {
            clearTimeout(timer);
            pending = undefined;
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            pending = undefined;
            reject(error);
          },
        };
        socket.write(JSON.stringify({ id, method, params }) + "\n");
      });
    },
    close() {
      socket.destroy();
    },
  };
}

export async function awaitStartupReady({
  endpoint,
  inject,
  check = () => {},
  timeoutMs = 60000,
  previousEpoch,
}) {
  const deadline = performance.now() + timeoutMs,
    attempts = [];
  const isReady = (value) =>
    value.vimActive &&
    value.startupSequence > 0 &&
    value.startupSentinel?.ready;
  while (performance.now() < deadline) {
    check();
    const before = await endpoint.call("passive");
    assert.notEqual(before.epoch, previousEpoch, "probe epoch did not change");
    if (isReady(before)) {
      attempts.push({ before });
      return { attempts, ready: before, observedAt: performance.now() };
    }
    inject(["ctrl+alt+8"]);
    const after = await endpoint.call("passive");
    attempts.push({ before, after });
    if (isReady(after))
      return { attempts, ready: after, observedAt: performance.now() };
    await sleep(10);
  }
  throw new Error("passive startup readiness did not arrive");
}
