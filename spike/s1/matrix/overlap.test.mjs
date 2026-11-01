import test from "node:test";
import assert from "node:assert/strict";
import { cpuIds, overlapSegments } from "./overlap.mjs";

test("overlap counts actual intervals, treats adjacent boundaries as separate and detects SMT sharing", () => {
  assert.deepEqual(cpuIds("0-2,8"), [0, 1, 2, 8]);
  const intervals = [
    { id: "a", startedMs: 0, finishedMs: 10, cores: ["0:1"], backend: "x11" },
    { id: "b", startedMs: 5, finishedMs: 20, cores: ["0:2"], backend: "x11" },
    {
      id: "c",
      startedMs: 10,
      finishedMs: 15,
      cores: ["0:2"],
      backend: "wayland",
    },
  ];
  const segments = overlapSegments(intervals);
  assert.equal(Math.max(...segments.map((segment) => segment.instances)), 2);
  assert.deepEqual(segments[1].ids, ["a", "b"]);
  assert.deepEqual(segments[2].ids, ["b", "c"]);
  assert.equal(segments[1].collisions.length, 0);
  assert.equal(segments[2].collisions.length, 1);
  assert.equal(segments[2].nativeAlongsideAnotherIDE, true);
});
