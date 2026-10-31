import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { audit } from "./audit.mjs";

const allowPartialFocus = process.argv.includes("--partial-focus");
const directories = process.argv
  .slice(2)
  .filter((arg) => arg !== "--partial-focus");
assert.ok(directories.length, "usage: review-batch.mjs BATCH_DIRECTORY [...]");
for (const directory of directories) {
  const batch = JSON.parse(readFileSync(join(directory, "batch.json")));
  for (const run of batch.runs.filter((run) => run.finished)) {
    const file = join(directory, run.id + ".json");
    if (!existsSync(file)) {
      console.log(JSON.stringify({ id: run.id, error: "no raw result" }));
      continue;
    }
    const bytes = readFileSync(file),
      raw = JSON.parse(bytes),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!raw.finished) {
      console.log(
        JSON.stringify({ id: run.id, error: "raw result is incomplete" }),
      );
      continue;
    }
    const auditFile = file.replace(/\.json$/, "-audit.json");
    if (existsSync(auditFile))
      assert.equal(
        JSON.parse(readFileSync(auditFile)).rawSha256,
        sha256,
        "raw result changed after audit",
      );
    else {
      try {
        writeFileSync(
          auditFile,
          JSON.stringify(
            await audit(file, {
              allowPartialFocus:
                allowPartialFocus &&
                raw.gate === "focus" &&
                raw.status === "interrupted",
            }),
            null,
            2,
          ) + "\n",
          { flag: "wx" },
        );
      } catch (error) {
        console.log(JSON.stringify({ id: run.id, auditError: String(error) }));
        continue;
      }
    }
    const resourceFile = file.replace(/\.json$/, "-resource-review.json");
    if (existsSync(resourceFile))
      assert.equal(
        JSON.parse(readFileSync(resourceFile)).rawSha256,
        sha256,
        "raw result changed after resource review",
      );
    else {
      const log = readFileSync(join(directory, run.id + ".log"), "utf8");
      const lines = log
        .split("\n")
        .filter(
          (line) =>
            line.startsWith("Saved ") &&
            line.includes(run.id + ".json; sandbox logs retained at "),
        );
      const root = lines.at(-1)?.split("; sandbox logs retained at ").at(-1);
      assert.match(
        root ?? "",
        /^\/(?:var\/)?tmp\/s1-[A-Za-z0-9]+$/,
        "owned sandbox path unavailable",
      );
      execFileSync(
        process.execPath,
        [
          resolve(import.meta.dirname, "resource-review.mjs"),
          file,
          root,
          resourceFile,
        ],
        { stdio: "pipe" },
      );
    }
    const termination = JSON.parse(
      readFileSync(file.replace(/\.json$/, "-termination.json")),
    );
    assert.deepEqual(termination.cleanup.remaining, []);
    assert.deepEqual(termination.cleanup.errors, []);
    assert.deepEqual(raw.cleanup.remaining, []);
    assert.deepEqual(raw.cleanup.errors, []);
    console.log(
      JSON.stringify({
        id: run.id,
        status: raw.status,
        trials: raw.trials.length,
        resources: JSON.parse(readFileSync(resourceFile)).classification,
      }),
    );
  }
}
