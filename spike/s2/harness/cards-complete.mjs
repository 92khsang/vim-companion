// Completeness of candidate (b): renders the cards in the spike webview view under one settings set,
// reads the keys from the rendered row headers (th scope=row) over CDP, and compares each card with
// the completeness reference of the same version and settings set (cards-extract output).
// Usage: node spike/s2/harness/cards-complete.mjs <version> <display> <cdpPort> <set> <cards.json> <reference.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  startXvfb,
  openSession,
  stopCode,
  cdpWebviewEvaluate,
  buildInfo,
} from "./lib.mjs";
import { SETTINGS_SETS } from "./cards-extract.mjs";
import { auditRendered, RENDERED_CARDS_JS } from "./cards-completeness.mjs";

const [version, display, cdpPort, set, cardsFile, referenceFile, outFile] =
  process.argv.slice(2);
const settings = SETTINGS_SETS[set];
const reference = JSON.parse(readFileSync(referenceFile, "utf8"));
const authored = JSON.parse(readFileSync(cardsFile, "utf8"));
if (reference.set !== set || reference.version !== version)
  throw new Error("reference does not match version and set");
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const out = {
  version,
  set,
  settings,
  cards: [],
  build: buildInfo(),
  inputSha256: hash(cardsFile),
  referenceSha256: hash(referenceFile),
  started: new Date().toISOString(),
};
let xvfb, code;
try {
  if (out.build.dirty.length)
    throw new Error("completeness requires a clean frozen checkout");
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}complete-${set}-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings,
    cardsFile,
    spikeExtensions: ["s2-probe", "s2-cards"],
  });
  out.hello = code.hello;
  await code.probe.call("exec", {
    command: "workbench.view.extension.s2cards",
  });
  let rendered;
  for (let i = 0; i < 50 && !rendered; i++) {
    await sleep(300);
    try {
      const r = await cdpWebviewEvaluate(
        cdpPort,
        "vim-companion-spike.s2-cards",
        RENDERED_CARDS_JS,
      );
      if (Array.isArray(r) && r.length > 0) rendered = r;
    } catch (e) {
      out.lastError = String(e).slice(0, 300);
    }
  }
  if (!rendered) throw new Error(`cards did not render: ${out.lastError}`);
  out.rendered = rendered;
  Object.assign(out, auditRendered(rendered, authored, reference));
} catch (e) {
  out.error = String(e.stack ?? e);
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
  out.finished = new Date().toISOString();
  writeFileSync(outFile, JSON.stringify(out));
  if (out.error || out.verdict !== "pass") process.exitCode = 1;
}
