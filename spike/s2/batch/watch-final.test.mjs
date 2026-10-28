import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const watcher = fileURLToPath(new URL("./watch-final.sh", import.meta.url));
const complete = "2026-10-29T00:00:00Z stage=complete exit=0\n";

function run(
  t,
  {
    load = "not-found",
    status = complete,
    failed = false,
    gateExit = 0,
    gateResult = true,
    existing = false,
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "s2-watch-final-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const props =
    [
      `LoadState=${load}`,
      `ActiveState=${failed ? "failed" : "inactive"}`,
      "SubState=dead",
      `Result=${failed ? "exit-code" : "success"}`,
      `ExecMainStatus=${failed ? 7 : 0}`,
    ].join("\n") + "\n";
  writeFileSync(join(dir, "properties.txt"), props);
  writeFileSync(
    join(bin, "systemctl"),
    '#!/bin/bash\ncat "$S2_TEST_PROPERTIES"\n',
    { mode: 0o755 },
  );
  const statusPath = join(dir, "status.txt");
  if (status !== null) writeFileSync(statusPath, status);
  const gate = join(dir, "gate.sh");
  writeFileSync(
    gate,
    `#!/bin/bash
mkdir -p "$3"
${gateResult ? `printf '%s\\n' '{"verdict":"pass","stage":"complete","exitCode":0}' > "$3/result.json"` : ""}
exit ${gateExit}
`,
  );
  const results = join(dir, "results");
  if (existing) {
    mkdirSync(results);
    writeFileSync(join(results, "sentinel"), "keep this attempt\n");
  }
  const child = spawnSync(
    "bash",
    [watcher, "s2-test.service", statusPath, gate, dir, dir, results],
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        S2_TEST_PROPERTIES: join(dir, "properties.txt"),
      },
    },
  );
  assert.ifError(child.error);
  const verdictPath = join(results, "queue-and-gate.json");
  return {
    child,
    results,
    verdict: existsSync(verdictPath)
      ? JSON.parse(readFileSync(verdictPath, "utf8"))
      : null,
  };
}

test("an unloaded unit needs durable wrapper completion and a passing independent gate", (t) => {
  const { child, verdict } = run(t);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(verdict.verdict, "pass");
  assert.equal(verdict.queueResult, null);
  assert.equal(verdict.queueExitCode, null);
  assert.equal(verdict.wrapperStage, "complete");
});

for (const status of [
  null,
  "2026-10-29T00:00:00Z stage=differential exit=0\n",
  "2026-10-29T00:00:00Z stage=complete exit=143\n",
  "invalid stage=complete exit=0\n",
]) {
  test(`default success/0 properties do not accept an incomplete wrapper: ${status ?? "missing"}`, (t) => {
    const { child, verdict } = run(t, { status });
    assert.equal(child.status, 1);
    assert.equal(verdict.verdict, "not pass");
  });
}

test("a retained failed unit is rejected even with a complete wrapper", (t) => {
  const { child, verdict } = run(t, { load: "loaded", failed: true });
  assert.equal(child.status, 1);
  assert.equal(verdict.queueExitCode, 7);
  assert.equal(verdict.verdict, "not pass");
});

test("a retained successful unit records its actual exit status", (t) => {
  const { child, verdict } = run(t, { load: "loaded" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(verdict.queueResult, "success");
  assert.equal(verdict.queueExitCode, 0);
});

test("a failed independent gate cannot pass through a stale success result", (t) => {
  const { child, verdict } = run(t, { gateExit: 1 });
  assert.equal(child.status, 1);
  assert.equal(verdict.verdict, "not pass");
});

test("a gate must write an explicit passing result", (t) => {
  const { child, verdict } = run(t, { gateResult: false });
  assert.equal(child.status, 1);
  assert.equal(verdict.verdict, "not pass");
});

test("an existing gate attempt is preserved", (t) => {
  const { child, results, verdict } = run(t, { existing: true });
  assert.equal(child.status, 1);
  assert.equal(verdict, null);
  assert.equal(
    readFileSync(join(results, "sentinel"), "utf8"),
    "keep this attempt\n",
  );
});
