import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export const versions = {
  "1.134.0": "110a328ea54b42367b803ec53ee0bf52ef26b419",
  "1.141.0": "2a59476c9bfc",
};

export function buildMatrixRunner(baseline, source, options, boundedUrl) {
  assert.ok(Object.hasOwn(versions, options.version));
  assert.ok(["same", "separate"].includes(options.affinity));
  assert.ok(["entry-exit", "cancel"].includes(options.row ?? "entry-exit"));
  assert.equal(typeof options.editContext, "boolean");
  let code = baseline.toString();
  const replace = (before, after) => {
    assert.equal(
      code.split(before).length,
      2,
      "matrix runner hook must be unique: " + before,
    );
    code = code.replace(before, after);
  };
  // Imports and resource paths in this temporary runner still point to the
  // retained source tree. Existing entrypoints and guards are never rewritten.
  code = code.replace(
    /from "(\.\/[^\"]+)"/g,
    (_match, path) =>
      "from " + JSON.stringify(pathToFileURL(join(source, path)).href),
  );
  replace(
    "const source = import.meta.dirname;",
    "const source = " + JSON.stringify(source) + ";",
  );
  code =
    `import { installMatrix } from ${JSON.stringify(pathToFileURL(join(source, "matrix/install.mjs")).href)};\nconst matrixOptions = ${JSON.stringify(options)};\n` +
    code;
  if (boundedUrl) {
    replace(
      JSON.stringify(pathToFileURL(join(source, "bounded-gates.mjs")).href),
      JSON.stringify(boundedUrl),
    );
    replace(
      "      referencePath,\n      call,",
      `      referencePath,
      matrixPhase: async () => {
        if (!loaded) return 0;
        phaseSeed = (Math.imul(1664525, phaseSeed) + 1013904223) >>> 0;
        const delay = phaseSeed % 100;
        await sleep(delay);
        return delay;
      },
      call,`,
    );
  }
  replace(
    'assert.ok(gate === "entry-exit" || (!loaded && delayMs === 10));',
    'assert.ok(["entry-exit", "cancel"].includes(gate), "unsupported matrix row");',
  );
  replace(
    '  assert.equal(result.product.version, "1.141.0");',
    `  assert.equal(result.product.version, matrixOptions.version);
  assert.ok(result.product.commit.startsWith(${JSON.stringify(versions[options.version])}), "unexpected IDE build");`,
  );
  replace(
    "  if (boundary || visualDiagnostic) {",
    "  installMatrix({ source, extensions, result, options: matrixOptions });\n  if (boundary || visualDiagnostic) {",
  );
  replace(
    '    "editor.editContext": true,',
    '    "editor.editContext": matrixOptions.editContext,',
  );
  replace(
    "    const same = JSON.stringify(previous) === JSON.stringify(value);",
    `    const comparable = (snapshot) => snapshot && { ...snapshot, matrixObservation: undefined };
    const same = JSON.stringify(comparable(previous)) === JSON.stringify(comparable(value));`,
  );
  replace(
    "    return same && idle(value) ? value : false;",
    "    return same && idle(value) && value.matrixObservation.engineStable ? value : false;",
  );
  replace(
    "  result.settings = settings;",
    `  settings["extensions.experimental.affinity"] = matrixOptions.affinity === "separate"
    ? { "vim-companion-spike.s1-leader": 1 } : {};
  result.scope = "S1 " + (matrixOptions.row ?? "entry-exit") + " environment matrix; first-discrepancy stop; other required rows remain separate";
  result.condition.affinity = matrixOptions.affinity === "separate" ? "separate extension hosts" : "same extension host";
  result.settings = settings;`,
  );
  replace(
    "  else assert.equal(result.hello.pid, result.hello.leaderPid);",
    `  else if (matrixOptions.affinity === "separate") assert.notEqual(result.hello.pid, result.hello.leaderPid, "companion must run in a separate host");
  else assert.equal(result.hello.pid, result.hello.leaderPid);`,
  );
  return {
    code,
    baselineSha256: createHash("sha256").update(baseline).digest("hex"),
  };
}
