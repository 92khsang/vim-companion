import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  processIdentity,
  recordOwned,
  readOwned,
  groupAlive,
  terminateOwned,
} from "./lifecycle.mjs";

test("owned groups that ignore TERM are killed and confirmed absent", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000);',
    ],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("fixture did not start")),
        2000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("error", reject);
    });
    const identity = processIdentity(child.pid);
    assert.equal(identity.group, child.pid);
    const ledger = join(
      mkdtempSync(join(tmpdir(), "s1-lifecycle-test-")),
      "owned.json",
    );
    recordOwned(ledger, [child]);
    assert.deepEqual(readOwned(ledger, process.pid), [identity]);
    assert.throws(() => readOwned(ledger, process.pid + 1), /owner/);
    assert.throws(
      () => groupAlive({ ...identity, startTicks: "different" }),
      /reused/,
    );
    const result = await terminateOwned([identity], {
      graceMs: 75,
      killWaitMs: 1000,
    });
    await exited;
    assert.deepEqual(
      result.signals.map((event) => event.signal),
      ["SIGTERM", "SIGKILL"],
    );
    assert.deepEqual(result.remaining, []);
    assert.equal(groupAlive(identity), false);
    recordOwned(ledger, [child]);
    assert.deepEqual(
      readOwned(ledger, process.pid),
      [identity],
      "an exited group leader must remain in the ownership ledger",
    );
  } finally {
    const identity = processIdentity(child.pid);
    if (identity)
      await terminateOwned([identity], { graceMs: 0, killWaitMs: 1000 });
  }
});
