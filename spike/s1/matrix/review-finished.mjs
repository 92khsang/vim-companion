import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { packArtifact, verifyArchive } from "./archive.mjs";

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const directories = args.filter((arg) => arg !== "--watch");
assert.ok(
  directories.length,
  "usage: review-finished.mjs [--watch] BATCH_DIRECTORY [...]",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const methodSha256 = hash(readFileSync(import.meta.filename));
const seen = new Set();
const records = new Map(directories.map((directory) => [directory, []]));

function nextAnalysis(directory, id, kind, rawSha256, sourceHash) {
  const candidates = readdirSync(directory)
    .filter(
      (name) => name.startsWith(`${id}-${kind}-`) && name.endsWith(".json"),
    )
    .map((name) => ({
      name,
      value: JSON.parse(readFileSync(join(directory, name))),
    }));
  const matching = candidates.find(
    ({ value }) =>
      value.rawSha256 === rawSha256 &&
      (value.method?.sources?.["focus-analysis.mjs"] ?? value.methodSha256) ===
        sourceHash,
  );
  if (matching) return { file: join(directory, matching.name), existing: true };
  const revision =
    Math.max(
      0,
      ...candidates.map(({ name }) =>
        Number(name.match(/-(\d+)\.json$/)?.[1] ?? 0),
      ),
    ) + 1;
  return {
    file: join(
      directory,
      `${id}-${kind}-${String(revision).padStart(2, "0")}.json`,
    ),
    existing: false,
  };
}

async function reviewRun(directory, run) {
  const file = join(directory, run.id + ".json");
  const bytes = readFileSync(file),
    raw = JSON.parse(bytes),
    rawSha256 = hash(bytes);
  assert.ok(
    raw.finished,
    "batch claims completion before raw measurement finishes",
  );
  execFileSync(
    process.execPath,
    [
      join(import.meta.dirname, "review-batch.mjs"),
      "--partial-focus",
      "--run",
      run.id,
      directory,
    ],
    { stdio: "pipe" },
  );
  const partial =
    raw.gate === "focus" &&
    ["interrupted", "harness-error"].includes(raw.status);
  const audit = JSON.parse(
    readFileSync(
      file.replace(/\.json$/, partial ? "-audit-partial.json" : "-audit.json"),
    ),
  );
  assert.equal(audit.rawSha256, rawSha256);
  const resource = JSON.parse(
    readFileSync(file.replace(/\.json$/, "-resource-review.json")),
  );
  assert.equal(resource.rawSha256, rawSha256);
  const record = {
    id: run.id,
    rawSha256,
    status: raw.status,
    trials: raw.trials.length,
    resources: resource.classification,
  };
  if (
    raw.gate === "focus" ||
    (raw.gate.startsWith("vb-") && raw.status === "remap-recorded")
  ) {
    const focus = raw.gate === "focus";
    const sourceHash = hash(
      readFileSync(
        join(
          import.meta.dirname,
          focus ? "focus-analysis.mjs" : "remap-analysis.mjs",
        ),
      ),
    );
    const output = nextAnalysis(
      directory,
      run.id,
      focus ? "analysis" : "native-keys",
      rawSha256,
      sourceHash,
    );
    if (!output.existing)
      execFileSync(
        process.execPath,
        [
          join(
            import.meta.dirname,
            focus ? "focus-analysis.mjs" : "remap-analysis.mjs",
          ),
          file,
          output.file,
        ],
        { stdio: "pipe" },
      );
    const analysis = JSON.parse(readFileSync(output.file));
    record.analysis = relative(directory, output.file);
    record.analysisSha256 = hash(readFileSync(output.file));
    if (focus)
      record.scenarios = analysis.scenarios.map(
        ({
          id,
          trials,
          issues,
          provenServerWaitTrials,
          fixedDelayWaitTrials,
        }) => ({
          id,
          trials,
          issues,
          provenServerWaitTrials,
          fixedDelayWaitTrials,
        }),
      );
    else record.unknownNativeKeyPaths = analysis.unknown;
  }
  for (const artifact of [file, file.replace(/\.json$/, ".log")]) {
    if (
      !existsSync(artifact) ||
      (artifact === file && statSync(artifact).size < 1024 * 1024)
    )
      continue;
    if (existsSync(artifact + ".gz")) await verifyArchive(artifact + ".gz");
    else await packArtifact(artifact);
  }
  return record;
}

do {
  let allFinished = true;
  for (const directory of directories) {
    let batch;
    try {
      batch = JSON.parse(readFileSync(join(directory, "batch.json")));
    } catch (error) {
      if (!watch || !(error instanceof SyntaxError)) throw error;
      allFinished = false;
      continue;
    }
    allFinished &&= Boolean(batch.finished);
    let changed = false;
    for (const run of batch.runs.filter((run) => run.finished)) {
      const key = directory + "/" + run.id;
      if (seen.has(key)) continue;
      let record;
      try {
        record = await reviewRun(directory, run);
      } catch (error) {
        record = { id: run.id, reviewError: String(error) };
      }
      seen.add(key);
      records.get(directory).push(record);
      changed = true;
      console.log(JSON.stringify({ batch: directory, ...record }));
    }
    if (changed || batch.finished) {
      const progress = {
        methodSha256,
        reviewedAt: new Date().toISOString(),
        provisional: !batch.finished,
        records: records.get(directory),
      };
      writeFileSync(
        join(directory, "review-progress.json"),
        JSON.stringify(progress, null, 2).replaceAll(
          process.env.HOME,
          "$HOME",
        ) + "\n",
      );
    }
  }
  if (!watch || allFinished) break;
  await sleep(30000);
} while (true);
