import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";

// Supplemental evidence: never rewrite a run's configured worker limit.
const [output, ...directories] = process.argv.slice(2);
assert.ok(output && directories.length);
const runs = [];
for (const directory of directories) {
  const batch = JSON.parse(readFileSync(join(directory, "batch.json")));
  assert.ok(
    batch.finished,
    "wait for the batch to finish before auditing overlap",
  );
  for (const run of batch.runs) {
    const file = join(directory, run.id + ".json");
    const raw = JSON.parse(readFileSync(file));
    for (const interval of raw.matrix?.ideLaunchers ?? [
      raw.matrix?.ideLauncher,
    ]) {
      assert.ok(
        interval?.started && interval?.finished,
        "IDE interval is incomplete: " + file,
      );
      const start = Date.parse(interval.started),
        end = Date.parse(interval.finished);
      assert.ok(Number.isFinite(start) && end >= start);
      runs.push({
        batch: basename(resolve(directory)),
        id: run.id + (interval.id ? "/" + interval.id : ""),
        cpuSet: run.cpuSet,
        configuredMaximum: raw.condition.instances,
        start,
        end,
      });
    }
  }
}
const boundaries = [
  ...new Set(runs.flatMap((run) => [run.start, run.end])),
].sort((a, b) => a - b);
const segments = boundaries.slice(0, -1).map((start, index) => {
  const end = boundaries[index + 1];
  const active = runs.filter((run) => run.start <= start && run.end > start);
  return { start, end, active };
});
const review = {
  method:
    "Concurrent owned IDE launcher intervals across the named batches; end is exclusive. Counts exclude unrelated user applications. Raw configured worker limits are unchanged.",
  maximumConcurrentInstances: Math.max(
    ...segments.map((segment) => segment.active.length),
  ),
  runs: runs.map((run) => {
    const overlap = segments.filter((segment) => segment.active.includes(run));
    return {
      ...run,
      started: new Date(run.start).toISOString(),
      finished: new Date(run.end).toISOString(),
      minimumConcurrentInstances: Math.min(
        ...overlap.map((segment) => segment.active.length),
      ),
      maximumConcurrentInstances: Math.max(
        ...overlap.map((segment) => segment.active.length),
      ),
      overlappingRuns: [
        ...new Set(
          overlap.flatMap((segment) =>
            segment.active
              .filter((other) => other !== run)
              .map((other) => other.batch + "/" + other.id),
          ),
        ),
      ],
    };
  }),
};
writeFileSync(output, JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    maximumConcurrentInstances: review.maximumConcurrentInstances,
    runs: runs.length,
  }),
);
