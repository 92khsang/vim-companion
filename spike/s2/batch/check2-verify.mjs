// Run from the final frozen checkout with the S2 environment still set:
// node spike/s2/batch/check2-verify.mjs <check2 dir> <full HEAD SHA>
// The four outputs must be complete-<set>-<version>.json. Input and engine references are rebuilt
// or read from this checkout, never accepted from the renderer's own summary.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual as same } from "node:util";
import { gunzipSync } from "node:zlib";
import { buildInfo, REPO } from "../harness/lib.mjs";
import { SETTINGS_SETS } from "../harness/cards-extract.mjs";
import { auditRendered } from "../harness/cards-completeness.mjs";
import { PRODUCTS } from "./check1-verify.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function verifyCheck2(dir, head) {
  const build = buildInfo();
  if (
    !/^[0-9a-f]{40}$/.test(head ?? "") ||
    build.head !== head ||
    build.dirty.length
  )
    throw new Error("run from the requested clean frozen checkout");
  for (const [version, commit] of Object.entries(PRODUCTS))
    if (!same(build.external.code[version], { version, commit }))
      throw new Error(
        `the sandbox environment does not select pinned product ${version}`,
      );
  if (
    !same(build.external.extBaseFolders, [
      "vscodevim.vim-1.32.4",
      "vspacecode.whichkey-0.11.4",
    ])
  )
    throw new Error(
      "the sandbox environment does not select the pinned engines",
    );
  const fresh = mkdtempSync(join(tmpdir(), "s2-rendered-input-"));
  const problems = [],
    conditions = [];
  try {
    execFileSync(
      process.execPath,
      [join(REPO, "spike/s2/check1/build.mjs"), fresh],
      { stdio: "pipe" },
    );
    const names = Object.keys(PRODUCTS).flatMap((version) =>
      ["defaults", "extensions"].map(
        (set) => `complete-${set}-${version}.json`,
      ),
    );
    if (
      !same(
        readdirSync(dir)
          .filter((name) => /^complete-.*\.json$/.test(name))
          .sort(),
        [...names].sort(),
      )
    )
      problems.push("expected exactly four rendered condition files");
    for (const version of Object.keys(PRODUCTS))
      for (const set of ["defaults", "extensions"]) {
        const name = `complete-${set}-${version}.json`;
        const out = JSON.parse(readFileSync(join(dir, name), "utf8"));
        const inputBytes = readFileSync(join(fresh, `cards-${set}.json`));
        const referenceBytes = gunzipSync(
          readFileSync(
            join(
              REPO,
              `spike/s2/data/cards-reference/cards3-${set}-${version}.json.gz`,
            ),
          ),
        );
        const reference = JSON.parse(referenceBytes),
          authored = JSON.parse(inputBytes);
        if (!same(out.build, build))
          problems.push(
            `${name}: build differs from the frozen checkout and sandbox installation`,
          );
        if (
          out.error ||
          out.verdict !== "pass" ||
          out.version !== version ||
          out.set !== set ||
          !same(out.settings, SETTINGS_SETS[set]) ||
          out.hello?.vscode !== version ||
          out.hello?.vim?.version !== "1.32.4" ||
          out.hello?.whichkey?.version !== "0.11.4" ||
          out.hello?.adapter !== null
        )
          problems.push(
            `${name}: failed run or unexpected condition/installed engine`,
          );
        if (
          out.inputSha256 !== hash(inputBytes) ||
          out.referenceSha256 !== hash(referenceBytes)
        )
          problems.push(`${name}: stale input or mismatched engine reference`);
        if (!Array.isArray(out.rendered)) {
          problems.push(`${name}: rendered cell evidence missing`);
          continue;
        }
        const audit = auditRendered(out.rendered, authored, reference);
        if (
          audit.verdict !== "pass" ||
          audit.summary.cards !== 59 ||
          audit.summary.renderedCards !== 59 ||
          !same(out.summary, audit.summary) ||
          !same(out.cards, audit.cards) ||
          !same(out.problems, audit.problems)
        )
          problems.push(
            `${name}: rendered cards, rows or cells differ from the independent audit`,
          );
        if (
          !Number.isFinite(Date.parse(out.started)) ||
          !Number.isFinite(Date.parse(out.finished)) ||
          Date.parse(out.finished) < Date.parse(out.started)
        )
          problems.push(`${name}: missing or reversed run timestamps`);
        conditions.push({ version, set, ...audit.summary });
      }
    return {
      verdict: problems.length ? "not pass" : "pass",
      head,
      build: build.id,
      conditions,
      problems,
    };
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = verifyCheck2(...process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (result.verdict !== "pass") process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify({ verdict: "not pass", error: error.message }, null, 2),
    );
    process.exitCode = 1;
  }
}
