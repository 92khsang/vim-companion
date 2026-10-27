// Delivery proof for the card-row key tokens that lib.mjs keysym could not type before 2026-10-27
// (check (1) of candidate (b)). For each token and one card per mode in which it is a row key, in a
// sandbox VS Code: reset, record a macro (`q z`), send the card's keys and the token as
// harness/card-keys.mjs plans them, read VSCodeVim's pending keys (the probe's test-only reader)
// and whether which-key's quick input opened, leave with `<Esc> <Esc>`, stop the macro (`q`, again
// if the reader still shows a recording) and read the keys of the recorded actions (probe
// macroActions). A token counts as delivered when it is among the pending keys or the keys of a
// recorded action; a remap key (such as Visual `<Space>`) shows as the quick input instead. This
// proves only which token VSCodeVim received; it writes no expectation.
// Tokens that card-keys.mjs marks unreachable on Linux are sent as the physical keys a user would
// try (raw xdotool keysyms), to record what VSCodeVim receives instead.
// <ExtensionDisable> runs `toggleVim`; the proof types `x` and reads the text (VSCodeVim off: the key
// is inserted), then runs `toggleVim` again and reads the reader state.
// Usage: node spike/s2/check1/keys-proof.mjs <version> <display> <cdpPort> <out.jsonl>
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  START,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  focusWindow,
  keysym,
  cdpEvaluate,
} from "../harness/lib.mjs";
import { TOKENS, planKeys } from "../harness/card-keys.mjs";

const [version, display, cdpPort, outFile] = process.argv.slice(2);
// The keys that left the editor last: the alternate file and the tag jump change the active editor.
const TOKENS_TO_PROVE = [
  "<down>",
  "<up>",
  "<left>",
  "<right>",
  "\n",
  " ",
  "<C-BS>",
  "<C-End>",
  "<C-Home>",
  "<C-left>",
  "<C-right>",
  "<D-right>",
  "<End>",
  "<S-BS>",
  "<D-left>",
  "<Home>",
  "<C-[>",
  "<ExtensionDisable>",
  "<copy>",
  "<D-a>",
  "<Del>",
  "<C-pagedown>",
  "<C-pageup>",
  "<D-d>",
  "<C-alt+down>",
  "<C-alt+up>",
  "<D-alt+down>",
  "<D-alt+up>",
  "<Insert>",
  "<plugcs>",
  "<plugds>",
  "<plugys>",
  "<C-shift+2>",
  "<C-]>",
  "<C-6>",
  "<C-^>",
];
// The physical keys a user would try for a token that nothing on Linux produces (card-keys.mjs).
const TRY_UNREACHABLE = Object.fromEntries(
  Object.entries(TOKENS)
    .filter(([, t]) => t.tries)
    .map(([k, t]) => [k, t.tries]),
);
const CARDS_DIR = new URL("./cards/", import.meta.url).pathname;
const cards = readdirSync(CARDS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")));
const modeOf = (id) => id.split(" ")[0];
/** One card per mode in which the token is a row key. */
function contexts(token) {
  const seen = new Map();
  for (const c of cards)
    if (c.rows.some((r) => r.key === token) && !seen.has(modeOf(c.card)))
      seen.set(modeOf(c.card), c);
  return [...seen.values()];
}
writeFileSync(outFile, "");
const write = (r) => appendFileSync(outFile, JSON.stringify(r) + "\n");
const portable = (s) =>
  String(s)
    .replaceAll(process.env.HOME ?? "\0", "$HOME")
    .replaceAll(process.env.S2_ROOT ?? "\0", "$S2_ROOT");
const xdoRaw = (keys) =>
  execFileSync(
    "xdotool",
    ["key", "--clearmodifiers", "--delay", "30", ...keys],
    {
      env: { PATH: process.env.PATH, DISPLAY: display },
    },
  );
const QUICK_INPUT = `(() => { const w = document.querySelector('.quick-input-widget');
  return !!w && getComputedStyle(w).display !== 'none' && !w.classList.contains('quick-input-widget-closing'); })()`;

let xvfb;
let code;
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}keys-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings: {},
  });
  write({
    type: "meta",
    version,
    hello: code.hello,
    started: new Date().toISOString(),
  });
  const files = [
    { path: join(code.inst, "ws/a.txt"), viewColumn: 1 },
    { path: join(code.inst, "ws/b.txt"), viewColumn: 2 },
  ];
  async function stopRecording() {
    for (let i = 0; i < 3; i++) {
      const st = await code.probe.call("vimState");
      if (!st.recording) return i;
      typeKeys(display, ["<Esc>", "<Esc>", "q"], 30);
      await sleep(400);
    }
    throw new Error("a macro recording did not stop");
  }
  async function resetAll() {
    typeKeys(display, ["<Esc>", "<Esc>", "v", "<Esc>"], 30);
    await sleep(80);
    let snap = await code.probe.call("snapshot");
    if (
      snap.editors.length !== 2 ||
      !snap.active?.endsWith("/a.txt") ||
      snap.activeViewColumn !== 1
    ) {
      // As cards-correctness.mjs: reopen without closing (closing the modified a.txt would prompt).
      if (snap.editors.length !== 2)
        await code.probe.call("exec", {
          command: "workbench.action.joinAllGroups",
        });
      await code.probe.call("open", { files });
      focusWindow(code);
      await code.probe.call("exec", {
        command: "workbench.action.focusFirstEditorGroup",
      });
    }
    await stopRecording();
    await code.probe.call("reset", START);
    await sleep(200);
  }
  const pendingOf = (st) =>
    st?.handler
      ? [
          ...st.fields.actionsRun.flatMap((a) => a.keysPressed),
          ...st.fields.actionKeys,
          ...st.fields.bufferedKeys,
        ]
      : [];
  async function recorded(send) {
    await resetAll();
    typeKeys(display, ["q", "z"], 30);
    await sleep(200);
    await send();
    await sleep(400);
    const quickInput = await cdpEvaluate(Number(cdpPort), QUICK_INPUT).catch(
      () => null,
    );
    const st = await code.probe.call("vimState");
    const snap = await code.probe.call("snapshot");
    const left =
      !snap.active?.endsWith("/a.txt") || snap.activeViewColumn !== 1;
    // A key that changed the active editor: reopen a.txt in the first group, where the macro is
    // being recorded, so that `q` stops it there.
    if (left) {
      await code.probe.call("open", { files });
      focusWindow(code);
    }
    typeKeys(display, ["<Esc>", "<Esc>", "q"], 30);
    await sleep(400);
    const extraQuits = await stopRecording();
    const macro = await code.probe.call("macroActions", { name: "z" });
    return {
      pending: pendingOf(st),
      mode: st?.state?.mode ?? null,
      quickInput,
      macro,
      active: snap.active?.replace(/^.*\//, "") ?? null,
      activeViewColumn: snap.activeViewColumn,
      cursors:
        snap.editors.find((e) => e.uri === snap.active)?.selections?.length ??
        null,
      extraQuits,
    };
  }
  // "action": the token is among the keys VSCodeVim took; "remap": `<Space>`, the generated
  // which-key leader (spec/generated/vscode/vim-remaps.json), opened which-key's quick input.
  const deliveredAs = (token, r) =>
    [...r.pending, ...(r.macro ?? []).flatMap((a) => a.keys)].includes(token)
      ? "action"
      : token === " " && r.quickInput
        ? "remap"
        : null;
  for (const token of TOKENS_TO_PROVE) {
    const special = TOKENS[token];
    try {
      if (special?.exec) {
        await resetAll();
        await code.probe.call("exec", { command: special.exec });
        await sleep(400);
        const off = await code.probe.call("vimState");
        typeKeys(display, ["x"], 30);
        await sleep(300);
        const snap = await code.probe.call("snapshot");
        const text =
          snap.editors.find((e) => e.uri === snap.active)?.text ?? null;
        const changed = text !== null && text !== START.lines.join("\n") + "\n";
        await code.probe.call("exec", { command: special.teardown });
        await sleep(600);
        typeKeys(display, ["<Esc>"], 30);
        await sleep(200);
        const on = await code.probe.call("vimState");
        write({
          type: "proof",
          token,
          how: { exec: special.exec },
          handlerAfterToggle: off.handler,
          xInsertedWhileOff: changed,
          handlerAfterSecondToggle: on.handler,
          modeAfterSecondToggle: on.state?.mode ?? null,
          delivered: off.handler === false && changed && on.handler === true,
        });
        continue;
      }
      if (special?.unreachable) {
        for (const raw of TRY_UNREACHABLE[token] ?? [])
          for (const c of contexts(token).slice(0, 1)) {
            const r = await recorded(async () => {
              if (c.keys.length) typeKeys(display, c.keys, 30);
              xdoRaw(raw);
            });
            write({
              type: "proof",
              token,
              card: c.card,
              how: { raw },
              ...r,
              delivered: Boolean(deliveredAs(token, r)),
              deliveredAs: deliveredAs(token, r),
              unreachable: special.unreachable,
            });
          }
        continue;
      }
      for (const c of contexts(token)) {
        const plan = planKeys([...c.keys, token]);
        const r = await recorded(async () => {
          for (const s of plan.steps) {
            if (s.keys) typeKeys(display, s.keys, 30);
            if (s.exec) await code.probe.call("exec", { command: s.exec });
          }
        });
        write({
          type: "proof",
          token,
          card: c.card,
          how: {
            keys: plan.steps.flatMap((s) => (s.keys ? s.keys.map(keysym) : [])),
          },
          ...r,
          delivered: Boolean(deliveredAs(token, r)),
          deliveredAs: deliveredAs(token, r),
        });
      }
    } catch (e) {
      write({ type: "proof-error", token, error: portable(e.stack ?? e) });
    }
  }
  write({ type: "end", finished: new Date().toISOString() });
} catch (e) {
  write({ type: "error", error: portable(e.stack ?? e) });
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
