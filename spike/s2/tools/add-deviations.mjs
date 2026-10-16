// Adds the VSCodeVim deviations to spec/fixtures/grammar from fixture-run output: a read gets an
// engines.vscodevim state only when every trial on every given run (both VS Code versions) saw the
// same state and that state differs from Vim's. The finding text for each kind of deviation is
// written by hand below; the state is the measured one.
// Usage: node spike/s2/tools/add-deviations.mjs <run.jsonl>...
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../..");
const RUN =
  "in VS Code 1.134.0 and 1.141.0 with VSCodeVim 1.32.4 and its default settings (harness of issue #11; spike/s2/data/fixture-reader-v2)";
const SURROUND = { d: "ds", c: "cs", y: "ys" };
const text = (caseId, at, keys, trials) => {
  const last = keys.at(-1);
  if (at === "key" && SURROUND[last]) {
    return `Measured: on 2026-10-16, ${RUN}, VSCodeVim held ${last} in its remap buffer as a prefix of its default surround mapping ${SURROUND[last]} (vim.surround is on by default) and had not started the ${last} operator 100 ms after the key, in ${trials} of ${trials} trials at 10, 30 and 60 ms injected key delay. It started the operator when vim.timeout ran out.`;
  }
  if (at === "timeout" && caseId.endsWith("/gr-normal")) {
    return `Measured: on 2026-10-16, ${RUN}, when vim.timeout ran out after gr, VSCodeVim ran g and r as actions, found no gr action (vim.replaceWithRegister is off by default) and dropped both keys, in ${trials} of ${trials} trials at 10, 30 and 60 ms injected key delay. Vim's built-in gr{char} still waits for a character.`;
  }
  if (at === "timeout" && caseId.endsWith("/gr-visual")) {
    return `Measured: on 2026-10-16, ${RUN}, when vim.timeout ran out after gr in Visual mode, VSCodeVim ran g and r as actions, found no Visual-mode gr action and dropped both keys, staying in Visual mode, in ${trials} of ${trials} trials at 10, 30 and 60 ms injected key delay. Vim's built-in gr{char} still waits for a character.`;
  }
  throw new Error(`no finding text for ${caseId} ${at} ${keys.join("")}`);
};

const groups = new Map();
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.type !== "read") continue;
    const k = `${r.case}|${r.k}|${r.at}`;
    const g = groups.get(k) ?? {
      states: new Set(),
      n: 0,
      expect: r.expect,
      keys: r.keys,
      at: r.at,
      k: r.k,
      case: r.case,
    };
    g.states.add(JSON.stringify(r.state));
    g.n += 1;
    groups.set(k, g);
  }
}
const deviations = [...groups.values()].filter(
  (g) => g.states.size === 1 && [...g.states][0] !== JSON.stringify(g.expect),
);
const unstable = [...groups.values()].filter((g) => g.states.size > 1);
const dir = join(root, "spec/fixtures/grammar");
const byFile = new Map();
for (const d of deviations) {
  const [file, id] = d.case.split("/");
  if (!byFile.has(file))
    byFile.set(
      file,
      JSON.parse(readFileSync(join(dir, `${file}.json`), "utf8")),
    );
  const c = byFile.get(file).cases.find((x) => x.id === id);
  const target = d.at === "timeout" ? c.afterTimeout : c.steps[d.k - 1];
  target.engines = {
    vscodevim: {
      expect: JSON.parse([...d.states][0]),
      deviation: text(d.case, d.at, d.keys, d.n / 2),
    },
  };
}
for (const [file, data] of byFile)
  writeFileSync(
    join(dir, `${file}.json`),
    JSON.stringify(data, null, 2) + "\n",
  );
console.log(
  `${deviations.length} deviations in ${byFile.size} files; ${unstable.length} reads with more than one state: ${unstable.map((u) => `${u.case}#${u.k}${u.at}`).join(", ")}`,
);
