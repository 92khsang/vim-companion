// Completeness of candidate (b): renders the cards in the spike webview view under one settings set,
// reads the keys from the rendered row headers (th scope=row) over CDP, and compares each card with
// the completeness reference of the same version and settings set (cards-extract output).
// Usage: node spike/s2/harness/cards-complete.mjs <version> <display> <cdpPort> <set> <cards.json> <reference.json> <out.json>
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  startXvfb,
  openSession,
  stopCode,
  cdpWebviewEvaluate,
  CARDS_DOM_JS,
  SPIKE_EXTENSIONS,
} from "./lib.mjs";
import { SETTINGS_SETS } from "./cards-extract.mjs";
import { rowsOf } from "./cards-count.mjs";

const [version, display, cdpPort, set, cardsFile, referenceFile, outFile] =
  process.argv.slice(2);
const settings = SETTINGS_SETS[set];
const reference = JSON.parse(readFileSync(referenceFile, "utf8"));
if (reference.set !== set || reference.version !== version)
  throw new Error("reference does not match version and set");
cpSync(cardsFile, join(SPIKE_EXTENSIONS, "s2-cards", "cards.json"));
const out = { version, set, cards: [], started: new Date().toISOString() };
let xvfb, code;
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `complete-${set}-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings,
    spikeExtensions: ["s2-probe", "s2-cards"],
  });
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
        CARDS_DOM_JS,
      );
      if (Array.isArray(r) && r.length > 0) rendered = r;
    } catch (e) {
      out.lastError = String(e).slice(0, 300);
    }
  }
  if (!rendered) throw new Error(`cards did not render: ${out.lastError}`);
  const byId = new Map(rendered.map((c) => [c.id, c]));
  let missing = 0;
  let extra = 0;
  for (const card of reference.cards) {
    const want = new Set(rowsOf(card, reference.settings).keys());
    const r = byId.get(card.id);
    const got = new Set(r ? r.keys : []);
    const miss = [...want].filter((k) => !got.has(k));
    const ext = [...got].filter((k) => !want.has(k));
    const dup = r ? r.keys.length - got.size : 0;
    missing += miss.length;
    extra += ext.length + dup;
    out.cards.push({
      id: card.id,
      rendered: Boolean(r),
      want: want.size,
      got: got.size,
      missing: miss,
      extra: ext,
      duplicates: dup,
      headers: r?.headers,
    });
  }
  out.summary = {
    cards: reference.cards.length,
    renderedCards: rendered.length,
    missing,
    extra,
  };
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
}
