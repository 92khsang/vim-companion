import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { faultCases } from "./fault.mjs";
import { hangulCases } from "./hangul.mjs";
import { waylandCases } from "./wayland.mjs";

export function completionJobs(version, backend) {
  assert.ok(["1.134.0", "1.141.0"].includes(version));
  assert.ok(["x11", "wayland", "focus"].includes(backend));
  const jobs = [];
  for (const delay of [10, 30, 60])
    for (const load of [false, true])
      for (const affinity of ["same", "separate"]) {
        const suffix = `${version.replaceAll(".", "")}-${load ? "loaded" : "idle"}-${affinity}-${delay}`;
        const common = { version, delay, load, affinity };
        const add = (row, options = {}, name = row) => {
          const job = { ...common, row, ...options, id: `${name}-${suffix}` };
          jobs.push(job);
          return job.id + ".json";
        };
        if (backend === "focus") {
          add("focus");
          add("focus", { accessibility: "on" }, "focus-accessible");
          continue;
        }
        if (backend === "wayland") {
          for (const kind of waylandCases)
            add("hangul", { backend, case: kind }, "wayland-" + kind);
          continue;
        }
        for (const editContext of [true, false])
          for (const row of ["entry-exit", "query"])
            add(
              row,
              { editContext },
              row + "-ec-" + (editContext ? "on" : "off"),
            );
        add("count");
        for (const key of ["f", "r", "d"]) {
          const native = add(
            "native-baseline",
            { case: key + "-space" },
            "native-baseline-" + key + "-space",
          );
          add(
            "native",
            { case: key + "-space", baseline: native },
            "native-" + key + "-space",
          );
        }
        const visual = add("visual-baseline");
        for (const kind of ["character", "line", "block"])
          add("visual", { case: kind, baseline: visual }, "visual-" + kind);
        for (const prefix of ["root", "w"])
          for (const key of ["escape", "ctrl+[", "ctrl+c"])
            add(
              "cancel",
              { case: prefix + "-" + key },
              "cancel-" +
                prefix +
                "-" +
                key.replace("+[", "-bracket").replace("+", "-"),
            );
        for (const kind of faultCases)
          add("fault", { case: kind }, "fault-" + kind);
        add("restart");
        add("cold");
        for (const kind of hangulCases)
          add("hangul", { case: kind }, "hangul-" + kind);
        add("vb-entry");
        for (const kind of ["root", "prefix"])
          add("vb-pause", { case: kind }, "vb-pause-" + kind);
      }
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length);
  return jobs;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [version, backend, cpuSet, output] = process.argv.slice(2);
  assert.ok(
    output,
    "usage: plan.mjs VERSION x11|wayland|focus CPU_SET OUTPUT.json",
  );
  const plan = {
    cpuSets: [cpuSet],
    globalConcurrentLimit: backend === "wayland" ? 1 : 2,
    jobs: completionJobs(version, backend),
  };
  writeFileSync(output, JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ version, backend, jobs: plan.jobs.length }));
}
