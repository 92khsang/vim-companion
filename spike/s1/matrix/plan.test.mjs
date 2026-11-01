import test from "node:test";
import assert from "node:assert/strict";
import { completionJobs } from "./plan.mjs";

test("completion plans cover every Linux condition and keep baseline dependencies ordered", () => {
  let measured = 0,
    focusObservations = 0;
  for (const version of ["1.134.0", "1.141.0"]) {
    const x11 = completionJobs(version, "x11");
    const native = completionJobs(version, "wayland");
    const focus = completionJobs(version, "focus");
    assert.equal(x11.length, 552);
    assert.equal(native.length, 132);
    assert.equal(focus.length, 24);
    const emitted = new Set();
    for (const job of x11) {
      if (job.baseline) assert.ok(emitted.has(job.baseline));
      emitted.add(job.id + ".json");
      assert.match(job.id, /^[a-z0-9-]+$/);
      if (!job.row.endsWith("-baseline")) measured++;
    }
    measured += native.length;
    focusObservations += focus.reduce(
      (sum, job) => sum + (job.accessibility === "on" ? 1 : 46) * 9,
      0,
    );
    for (const row of ["entry-exit", "query"])
      assert.equal(
        x11.filter((job) => job.row === row && job.editContext === false)
          .length,
        12,
      );
  }
  assert.equal(measured, 1272);
  assert.equal(focusObservations, 10152);
});
