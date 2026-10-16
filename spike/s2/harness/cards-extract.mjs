// Completeness reference for candidate (b): for each distinct state of the grammar fixture, the keys
// that may follow in VSCodeVim 1.32.4 under one settings set:
//   - action rows: keys after which an action of VSCodeVim's action table applies or could still
//     apply (VSCodeVim's own doesActionApply/couldActionApply on its real state, test-only reader);
//   - remap rows: keys that continue a remap (the generated remaps and VSCodeVim's default plugin
//     mappings that the settings turn on).
// Usage: node spike/s2/harness/cards-extract.mjs <version> <display> <cdpPort> <defaults|extensions> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
const RESET_KEYS = ["<Esc>", "<Esc>", "v", "<Esc>"];
import {
  REPO,
  START,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
} from "./lib.mjs";

export const SETTINGS_SETS = {
  defaults: {},
  extensions: {
    "vim.surround": false,
    "vim.targets.enable": true,
    "vim.camelCaseMotion.enable": true,
    "vim.sneak": true,
    "vim.replaceWithRegister": true,
  },
  // One setting changed at a time, to tell which setting a row depends on.
  "surround-off": { "vim.surround": false },
  targets: { "vim.targets.enable": true },
  camelcase: { "vim.camelCaseMotion.enable": true },
  sneak: { "vim.sneak": true },
  "replace-with-register": { "vim.replaceWithRegister": true },
};

export function cardStates() {
  const dir = join(REPO, "spec/fixtures/grammar");
  const seen = new Map();
  for (const n of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    for (const c of JSON.parse(readFileSync(join(dir, n), "utf8")).cases) {
      c.steps.forEach((s, i) => {
        const keys = c.steps.slice(0, i + 1).map((x) => x.key);
        const id = `${s.expect.mode} ${JSON.stringify(s.expect.pending)}`;
        if (!seen.has(id))
          seen.set(id, {
            id,
            mode: s.expect.mode,
            pending: s.expect.pending,
            keys,
            from: `${n.replace(".json", "")}/${c.id}#${i + 1}`,
          });
      });
    }
  }
  return [...seen.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [version, display, cdpPort, set, outFile] = process.argv.slice(2);
  const settings = SETTINGS_SETS[set];
  const out = {
    version,
    set,
    settings,
    started: new Date().toISOString(),
    cards: [],
  };
  let xvfb, code;
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, async () => {
      if (code) await stopCode(code);
      if (xvfb)
        try {
          process.kill(xvfb, "SIGTERM");
        } catch {}
      process.exit(1);
    });
  }
  try {
    xvfb = await startXvfb(display);
    code = await openSession({
      version,
      display,
      name: `cards-${set}-${version}-${display.slice(1)}`,
      cdpPort: Number(cdpPort),
      settings,
    });
    const tk = await code.probe.call("tableKeys");
    out.table = {
      actions: tk.actions,
      modes: tk.modes,
      tokens: tk.tokens.length,
    };
    const printable = [];
    for (let c = 33; c <= 126; c++) printable.push(String.fromCharCode(c));
    const placeholders = new Set([
      "<character>",
      "<register>",
      "<number>",
      "<alpha>",
      "<macro>",
      "<any>",
      "<leader>",
    ]);
    const universe = [
      ...new Set([
        ...printable,
        " ",
        ...tk.tokens.filter((t) => !placeholders.has(t)),
      ]),
    ];
    out.universe = universe.length;
    for (const card of cardStates()) {
      // v <Esc> clears hidden VSCodeVim state that two <Esc> leave: after "a in Visual Line mode
      // and <Esc>, VSCodeVim 1.32.4 ignored the next V (spike/s2/harness/repeat-keys.mjs).
      typeKeys(display, RESET_KEYS, 30);
      await sleep(80);
      await code.probe.call("reset", START);
      await sleep(200);
      typeKeys(display, card.keys, 30);
      await sleep(200);
      const before = (await code.probe.call("vimState")).fields;
      let resolved = before;
      if (before.bufferedKeys.length > 0) {
        await sleep(1150);
        resolved = (await code.probe.call("vimState")).fields;
      }
      const nk = await code.probe.call("nextKeys", { universe }, 120000);
      const brokeOnTimeout =
        before.bufferedKeys.length > 0 && nk.state.pending.length === 0;
      out.cards.push({
        ...card,
        bufferedBefore: before.bufferedKeys,
        resolvedState: nk.state,
        brokeOnTimeout,
        actionRows: brokeOnTimeout ? {} : nk.rows,
      });
    }
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
}
