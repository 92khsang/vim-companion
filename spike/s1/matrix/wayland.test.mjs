import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildMatrixRunner } from "./runner.mjs";
import { buildWaylandRunner } from "./wayland-runner.mjs";

test("native runner keeps compositor bus/XDG paths and replaces XTEST delivery", () => {
  const root = resolve(import.meta.dirname, "..");
  const value = buildMatrixRunner(readFileSync(join(root, "run.mjs")), root, {
    row: "hangul",
    case: "letter",
    backend: "wayland",
    version: "1.141.0",
    affinity: "separate",
    editContext: true,
    observe: true,
  });
  const code = buildWaylandRunner(value.code, root);
  const file = join(
    mkdtempSync(join(tmpdir(), "s1-wayland-syntax-")),
    "run.mjs",
  );
  writeFileSync(file, code);
  execFileSync(process.execPath, ["--check", file]);
  assert.ok(!code.includes('"dbus-run-session"'));
  assert.ok(!code.includes('XDG_RUNTIME_DIR: join(root, "runtime")'));
  assert.ok(!code.includes('execFileSync("setxkbmap"'));
  assert.ok(
    code.includes(
      "const inject = (keys) => nativeSession.inject(keys,delayMs)",
    ),
  );
  assert.ok(code.includes('"--wayland-text-input-version=3"'));
  assert.ok(code.includes("only entry-document cleanup may change"));
});
