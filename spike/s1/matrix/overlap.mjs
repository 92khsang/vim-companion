import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";

export function cpuIds(value) {
  assert.match(value, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  return value.split(",").flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    assert.ok(last >= first);
    return Array.from(
      { length: last - first + 1 },
      (_, index) => first + index,
    );
  });
}
export function overlapSegments(intervals) {
  const events = intervals
    .flatMap((interval, index) => [
      { at: interval.startedMs, type: 1, index },
      { at: interval.finishedMs, type: -1, index },
    ])
    .sort((a, b) => a.at - b.at || a.type - b.type);
  const active = new Set(),
    segments = [];
  let previous = null;
  for (const event of events) {
    if (previous !== null && event.at > previous && active.size) {
      const members = [...active].map((index) => intervals[index]);
      const collisions = [];
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          const shared = members[i].cores.filter((core) =>
            members[j].cores.includes(core),
          );
          if (shared.length)
            collisions.push({
              first: members[i].id,
              second: members[j].id,
              cores: shared,
            });
        }
      segments.push({
        started: new Date(previous).toISOString(),
        finished: new Date(event.at).toISOString(),
        instances: members.length,
        ids: members.map((member) => member.id),
        collisions,
        nativeAlongsideAnotherIDE:
          members.length > 1 &&
          members.some((member) => member.backend === "wayland"),
      });
    }
    if (event.type === 1) active.add(event.index);
    else active.delete(event.index);
    previous = event.at;
  }
  return segments;
}
export function reviewOverlap(directories, allowLive = false) {
  const intervals = [],
    exclusions = [],
    batches = [];
  const asOf = Date.now();
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  for (const directory of directories) {
    const bytes = readFileSync(join(directory, "batch.json")),
      batch = JSON.parse(bytes);
    if (!allowLive)
      assert.ok(
        batch.finished,
        "final overlap review requires finished batches",
      );
    batches.push({
      directory,
      sha256: hash(bytes),
      finished: batch.finished ?? null,
      externalBatches: batch.plan.externalBatches ?? [],
    });
    const topology = new Map(
      batch.cpuTopology
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const [cpu, core, socket] = line.split(",");
          return [Number(cpu), `${socket}:${core}`];
        }),
    );
    for (const run of batch.runs) {
      const file = join(directory, run.id + ".json");
      if (!existsSync(file)) {
        exclusions.push({
          file,
          reason: "no raw result yet; launcher not observed",
        });
        continue;
      }
      const rawBytes = readFileSync(file),
        raw = JSON.parse(rawBytes);
      const launchers =
        raw.matrix?.ideLaunchers ??
        (raw.matrix?.ideLauncher ? [raw.matrix.ideLauncher] : []);
      if (!launchers.length) {
        exclusions.push({ file, reason: "no IDE launcher recorded" });
        continue;
      }
      assert.equal(
        raw.condition.cpuAffinity,
        run.cpuSet,
        "runner affinity differs from planned worker",
      );
      const cores = [
        ...new Set(
          cpuIds(run.cpuSet).map((cpu) => {
            assert.ok(topology.has(cpu), "CPU absent from retained topology");
            return topology.get(cpu);
          }),
        ),
      ];
      for (const launcher of launchers) {
        const end =
          launcher.finished ??
          raw.cleanup?.finished ??
          (allowLive ? new Date(asOf).toISOString() : null);
        assert.ok(end, "IDE interval has no end bound");
        const startedMs = Date.parse(launcher.started),
          finishedMs = Date.parse(end);
        assert.ok(Number.isFinite(startedMs) && finishedMs >= startedMs);
        intervals.push({
          id: `${directory}/${run.id}:${launcher.id ?? "warm"}`,
          file,
          rawSha256: hash(rawBytes),
          pid: launcher.pid,
          cpuSet: run.cpuSet,
          cores,
          backend: raw.matrix.backend ?? "x11",
          configuredMaximum: raw.condition.instances,
          started: launcher.started,
          finished: end,
          startedMs,
          finishedMs,
          endEvidence: launcher.finished
            ? "IDE launcher exit"
            : raw.cleanup?.finished
              ? "owned cleanup upper bound"
              : "right-censored at review time",
        });
      }
    }
  }
  const segments = overlapSegments(intervals);
  return {
    reviewedAt: new Date(asOf).toISOString(),
    provisional: allowLive,
    method:
      "Observed IDE main-process lifetimes; cold child launches included. End bounds and incomplete records remain explicit. CPU cores use each batch's retained topology and runner affinity. Millisecond wall-clock timestamps are not sub-millisecond ordering evidence.",
    batches,
    missingExternalBatches: [
      ...new Set(batches.flatMap((batch) => batch.externalBatches)),
    ].filter(
      (name) => !batches.some((batch) => basename(batch.directory) === name),
    ),
    intervals,
    exclusions,
    segments,
    maximumObservedInstances: Math.max(
      0,
      ...segments.map((segment) => segment.instances),
    ),
    physicalCoreConflicts: segments.filter(
      (segment) => segment.collisions.length,
    ),
    nativeOverlap: segments.filter(
      (segment) => segment.nativeAlongsideAnotherIDE,
    ),
    configuredLimitViolations: segments.filter((segment) =>
      segment.ids.some(
        (id) =>
          segment.instances >
          intervals.find((interval) => interval.id === id).configuredMaximum,
      ),
    ),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    allowLive = args.includes("--live");
  const [output, ...directories] = args.filter((arg) => arg !== "--live");
  assert.ok(
    output && directories.length,
    "usage: overlap.mjs [--live] OUTPUT.json BATCH_DIRECTORY [...]",
  );
  const review = reviewOverlap(directories, allowLive);
  writeFileSync(output, JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({
      maximum: review.maximumObservedInstances,
      conflicts: review.physicalCoreConflicts.length,
      nativeOverlap: review.nativeOverlap.length,
      provisional: review.provisional,
    }),
  );
}
