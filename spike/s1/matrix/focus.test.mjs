import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { focusScenarios } from "./focus-scenarios.mjs";
import { focusKind } from "./focus.mjs";
import { buildMatrixRunner } from "./runner.mjs";

test("focus inventory covers 26 leaders and all 47 state/provider scenarios", () => {
  const catalog = JSON.parse(
    readFileSync(new URL("./catalog.json", import.meta.url)),
  );
  const rows = focusScenarios(catalog);
  assert.equal(rows.length, 47);
  assert.equal(new Set(rows.map((row) => row.id)).size, 47);
  assert.equal(new Set(rows.map((row) => row.leaf.leader)).size, 26);
  assert.equal(rows.filter((row) => row.delayed).length, 4);
  assert.equal(rows[0].state, "no-repository");
});

test("focus classification distinguishes Monaco-backed inputs from editor text", () => {
  assert.equal(focusKind({ editor: true, rename: true }), "text input");
  assert.equal(
    focusKind({ editor: true, scm: true, scmInput: true }),
    "text input",
  );
  assert.equal(focusKind({ editor: true, hover: true }), "other");
  assert.equal(focusKind({ dialog: true, quickInput: true }), "dialog");
  assert.equal(focusKind({ editor: true }), "editor text");
});

test("focus runner generates a valid isolated experiment without weakening the retained gate", () => {
  const root = resolve(import.meta.dirname, "..");
  const generated = buildMatrixRunner(
    readFileSync(join(root, "run.mjs")),
    root,
    {
      row: "focus",
      version: "1.141.0",
      affinity: "separate",
      editContext: true,
      observe: true,
    },
  );
  const file = join(mkdtempSync(join(tmpdir(), "s1-focus-syntax-")), "run.mjs");
  writeFileSync(file, generated.code);
  execFileSync(process.execPath, ["--check", file]);
  assert.ok(generated.code.includes("window,environment,check:matrixCheck"));
  assert.ok(generated.code.includes("only entry-document cleanup may change"));
});
