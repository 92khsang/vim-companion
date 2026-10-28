// Correctness of candidate (b): for each card row whose `when` holds under the settings set, types
// the card's keys and the row's key (the row's `sample` for a placeholder row) from the fixture
// start state, and compares the buffer text, the cursor, the mode and the registers after the key
// with the row's hand-written `expect`:
//   expect.text:      "unchanged", or { "<line index>": "<new line>" }, or ["<line>", ...]
//   expect.cursor:    [line, column] of the primary cursor (0-based)
//   expect.mode:      fixture mode name
//   expect.shiftNumbered: true when the key shifts the numbered registers 1-8 to 2-9
//   setup:            optional keys typed after the reset and before the card's keys
//   expect.registers: { "<name>": { "mode": "character" | "line" | "block", "lines": ["<line>", ...] } }
//                     for the registers the key writes (a recorded macro: { "mode", "keys" });
//                     every other register must hold what it held before the key
// A register is compared as (mode, lines): VSCodeVim's RegisterMode and its text split at "\n",
// which is what Vim's getregtype() and getreg(name, 1, 1) give. A linewise register holding `line`
// ({ mode: "line", lines: ["line"] }) and a charwise one holding `line\n` ({ mode: "character",
// lines: ["line", ""] }) are different values, and the record shows both.
// Usage: node spike/s2/harness/cards-correctness.mjs <version> <display> <cdpPort> <set> <cards.json> <trials> <out.jsonl> [card ids, comma-separated | #<from>-<to>]
// `#<from>-<to>` selects the cards with index from <= i < to in <cards.json> (batch/check1.sh runs
// the cards in chunks this way, because card ids hold commas). The meta record carries the build
// (lib.mjs buildInfo) and the probe's hello; an error record carries its phase (`boot` before the
// probe's first hello, `trials` after it) and the build.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  buildInfo,
  portable,
  cdpEvaluate,
  cdpWebviewEvaluate,
  STATUS_BAR_JS,
} from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { SETTINGS_SETS } from "./cards-extract.mjs";
import { planKeys } from "./card-keys.mjs";
import {
  needsLineUndoPreparation,
  needsScrollPreparation,
} from "./trial-preparation.mjs";
import { RENDERED_CARDS_JS, rowsFromRendered } from "./cards-completeness.mjs";

// The trial reset (resetTrial): <Esc> <Esc>, VS Code's expandLineSelection and <Esc>, the probe's
// reset of the text and cursor, then `v <Esc>`. Measured (check1 triage, 2026-10-28, 1.134.0 and
// 1.141.0): after a Visual Line trial whose stop moved (`V w`, `V j w`) or a Visual Block one,
// leaving the mode with <Esc> and resetting made VS Code hand about every second typed key to
// VSCodeVim as `replacePreviousChar` instead of `type`, which VSCodeVim 1.32.4 drops outside an IME
// composition (extensionBase.ts L339-367): 19 of 48 keys lost on each version with the old reset
// (<Esc> <Esc> v <Esc>, then the probe's reset), 0 of 48 after selecting the line with VS Code's
// own command first. `v <Esc>` runs after the cursor reset so that the last Visual area and the
// '< '> marks are at the start position in every trial.
const RESET_KEYS = ["<Esc>", "<Esc>"];
const RESET_TAIL = ["v", "<Esc>"];
const JUMP_KEYS = new Set(["<C-o>", "<C-i>", "<Tab>", "<C-t>"]);
const WINDOW_TARGET_KEYS = new Set(["l", "w", "<right>", "<C-l>", "<C-w>"]);
// VSCodeVim turned off (toggleVim): DisableExtension sets Mode.Disabled (actions.ts L43-L46), whose
// status bar text is "-- VIM: DISABLED --" (statusBar.ts L191-L192) and whose `vim.mode` context is
// "Disabled" (modeHandler.ts L1661); toggleExtension then clears every mode handler
// (extensionBase.ts L519-L526), so the reader finds none. The mode is then read from VSCodeVim's
// status bar item over CDP. Mode.Disabled is 12 (mode.ts L4-L18), "other-12" in the fixture's names.
const DISABLED_TEXT = "-- VIM: DISABLED --";
const DISABLED_MODE = "other-12";
// History commands await a QuickPick selection. Inspect the rendered picker before cancelling
// it in the next trial's reset, so an unchanged editor alone cannot pass a history-UI row.
const HISTORY_PICKER_JS = `(() => {
  const widget = document.querySelector('.quick-input-widget');
  const input = widget?.querySelector('input');
  const visible = !!widget && getComputedStyle(widget).display !== 'none' &&
    getComputedStyle(widget).visibility !== 'hidden' && widget.getBoundingClientRect().height > 0;
  return { visible, placeholder: input?.getAttribute('placeholder') ?? null,
    focused: visible && document.activeElement === input };
})()`;
const DEFAULTS = {
  "vim.surround": true,
  "vim.targets.enable": false,
  "vim.camelCaseMotion.enable": false,
  "vim.sneak": false,
  "vim.replaceWithRegister": false,
};
const [version, display, cdpPort, set, cardsFile, trialsArg, outFile, only] =
  process.argv.slice(2);
const settings = SETTINGS_SETS[set];
const inForce = { ...DEFAULTS, ...settings };
const holds = (when) =>
  !when || Object.entries(when).every(([k, v]) => inForce[k] === v);
const range = /^#(\d+)-(\d+)$/.exec(only ?? "");
const inputBytes = readFileSync(cardsFile);
const authored = JSON.parse(inputBytes);
const selected = (c, i) =>
  !only
    ? true
    : range
      ? i >= Number(range[1]) && i < Number(range[2])
      : only.split(",").includes(c.id);
let cards = authored.filter(selected);
const build = buildInfo();
let phase = "boot";
writeFileSync(outFile, "");
const write = (r) => appendFileSync(outFile, JSON.stringify(r) + "\n");
let code;
/** Types the key steps of a plan (card-keys.mjs) at 30 ms and runs its command steps in order. */
async function send(plan) {
  for (const step of plan.steps) {
    if (step.keys) typeKeys(display, step.keys, 30);
    if (step.exec) await code.probe.call("exec", { command: step.exec });
  }
}

function expectedText(expect) {
  if (expect.text === "unchanged") return START.lines;
  if (Array.isArray(expect.text)) return expect.text;
  const lines = [...START.lines];
  for (const [i, line] of Object.entries(expect.text)) lines[Number(i)] = line;
  return lines.filter((l) => l !== null);
}
const REGISTER_MODES = ["character", "line", "block"];
/** A probe register (one entry per cursor) as (mode, lines), or { cursors } for several cursors. */
const regValue = (r) => {
  if (!r) return undefined;
  const one = (c) =>
    typeof c.text === "string"
      ? { mode: c.mode, lines: c.text.split("\n") }
      : { mode: c.mode, keys: c.text?.keys ?? String(c.text) };
  return r.length === 1 ? one(r[0]) : { cursors: r.map(one) };
};
/** The same value with its keys in a fixed order, for comparison and the record. */
const canon = (v) =>
  v === undefined || v === null
    ? v
    : v.cursors
      ? { cursors: v.cursors.map(canon) }
      : { mode: v.mode, ...(v.lines ? { lines: v.lines } : { keys: v.keys }) };
const sameReg = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
// VSCodeVim creates the clipboard registers * and + when it first reads the clipboard; an empty
// one that did not exist before holds what the absent one meant (an empty clipboard), so the key
// did not write it.
const CLIPBOARD = new Set(["*", "+"]);
const isEmptyText = (v) =>
  v && !v.cursors && v.lines?.length === 1 && v.lines[0] === "";
const sameRegNamed = (name, a, b) =>
  sameReg(a, b) ||
  (CLIPBOARD.has(name) &&
    ((a === undefined && isEmptyText(canon(b))) ||
      (b === undefined && isEmptyText(canon(a)))));
// Every register expectation must name a mode and lines (or a macro's keys) before VS Code starts.
for (const card of cards)
  for (const row of card.rows)
    for (const [name, v] of Object.entries(row.expect?.registers ?? {})) {
      const ok =
        v &&
        typeof v === "object" &&
        REGISTER_MODES.includes(v.mode) &&
        ((Array.isArray(v.lines) &&
          v.lines.every((l) => typeof l === "string")) ||
          (name !== ":" && typeof v.keys === "string"));
      if (!ok)
        throw new Error(
          `${card.id} ${row.key}: register ${name} must be { mode, lines }; recorded keys are allowed only for non-Ex registers`,
        );
    }

let xvfb;
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
    name: `${process.env.S2_NAME_PREFIX ?? ""}correct-${set}-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings,
    cardsFile,
    spikeExtensions: ["s2-probe", "s2-cards"],
    onHostUp: () => {
      phase = "trials";
    },
  });
  // Read the same table cells as check (2), then close the panel before editor measurements so
  // opening the cards cannot change the viewport used by scroll and screen-line commands.
  const panelVisible = () =>
    cdpEvaluate(
      cdpPort,
      `(() => {
    const panel = document.querySelector('.part.panel');
    return !!panel && getComputedStyle(panel).display !== 'none' &&
      panel.getBoundingClientRect().height > 0;
  })()`,
    );
  const panelBeforeVisible = await panelVisible();
  if (panelBeforeVisible)
    throw new Error("the fresh correctness sandbox has an open panel");
  await code.probe.call("exec", {
    command: "workbench.view.extension.s2cards",
  });
  let rendered, lastRenderError;
  for (let i = 0; i < 50 && !rendered; i++) {
    await sleep(300);
    try {
      const cells = await cdpWebviewEvaluate(
        cdpPort,
        "vim-companion-spike.s2-cards",
        RENDERED_CARDS_JS,
      );
      if (Array.isArray(cells) && cells.length > 0) rendered = cells;
    } catch (error) {
      lastRenderError = String(error);
    }
  }
  if (!rendered)
    throw new Error(`correctness cards did not render: ${lastRenderError}`);
  cards = rowsFromRendered(rendered, authored, set).filter(selected);
  await code.probe.call("exec", { command: "workbench.action.closePanel" });
  await code.probe.call("exec", {
    command: "workbench.action.focusFirstEditorGroup",
  });
  focusWindow(code);
  await sleep(300);
  const panelAfterVisible = await panelVisible();
  if (panelAfterVisible)
    throw new Error("the cards panel did not close before correctness trials");
  write({
    type: "meta",
    version,
    set,
    settings,
    trials: Number(trialsArg),
    cards: cards.map((c) => c.id),
    only: only ?? null,
    rendered,
    inputSha256: createHash("sha256").update(inputBytes).digest("hex"),
    renderPreparation: { panelBeforeVisible, panelAfterVisible },
    build,
    hello: code.hello,
    started: new Date().toISOString(),
  });
  const files = [
    { path: join(code.inst, "ws/a.txt"), viewColumn: 1 },
    { path: join(code.inst, "ws/b.txt"), viewColumn: 2 },
  ];
  // b.txt (group 2) is the window and alternate file of the window and file rows (<C-w> l, <C-6>,
  // ...); a row that shows it can move its cursor, which later rows would read. It starts, and is
  // put back whenever the files are reopened, at the fixture's start state, as in the oracle's
  // harness layout (vim-check/expect.mjs S2_VIM_LAYOUT=harness).
  async function resetB() {
    await code.probe.call("exec", {
      command: "workbench.action.focusSecondEditorGroup",
    });
    await sleep(150);
    await code.probe.call("reset", START);
    await code.probe.call("exec", {
      command: "workbench.action.focusFirstEditorGroup",
    });
    await sleep(150);
  }
  // A target file can retain a prior row's edits, mode, or per-group view state
  // even when a.txt is active. Prepare the exact group the tested key will use.
  async function prepareTargetFile(viewColumn) {
    async function readTargetState() {
      const snap = await code.probe.call("snapshot");
      const editor = snap.editors.find(
        (e) => e.uri === snap.active && e.viewColumn === viewColumn,
      );
      return {
        file: snap.active?.replace(/^.*\//, "") ?? null,
        viewColumn: snap.activeViewColumn,
        text: editor?.text.replace(/\n$/, "").split("\n") ?? null,
        selections: editor?.selections ?? null,
        mode: (await code.probe.call("vimState")).state?.mode ?? null,
      };
    }
    await code.probe.call("open", {
      files: [{ path: files[1].path, viewColumn }],
    });
    focusWindow(code);
    await code.probe.call("exec", {
      command:
        viewColumn === 1
          ? "workbench.action.focusFirstEditorGroup"
          : "workbench.action.focusSecondEditorGroup",
    });
    const previous = await readTargetState();
    typeKeys(display, RESET_KEYS, 30);
    await sleep(150);
    await code.probe.call("reset", START);
    await sleep(150);
    const prepared = await readTargetState();
    const { line, column } = START.cursor;
    if (
      prepared.file !== "b.txt" ||
      prepared.viewColumn !== viewColumn ||
      JSON.stringify(prepared.text) !== JSON.stringify(START.lines) ||
      JSON.stringify(prepared.selections) !==
        JSON.stringify([[line, column, line, column]]) ||
      prepared.mode !== "normal"
    )
      throw new Error(
        `target-file preparation in group ${viewColumn} did not reach the fixture state`,
      );
    await code.probe.call("open", { files: [files[0]] });
    await code.probe.call("exec", {
      command: "workbench.action.closeOtherEditors",
    });
    await sleep(150);
    return { ...prepared, previous };
  }
  await resetB();
  // A row such as `q a` leaves a macro recording on, which would record the next rows and make a
  // later `q` stop it instead of starting one: every trial starts with no recording (up to 3 tries).
  async function stopRecording() {
    for (let i = 0; i < 3; i++) {
      const st = await code.probe.call("vimState");
      if (!st.recording) return i;
      typeKeys(display, ["<Esc>", "<Esc>", "q"], 30);
      await sleep(400);
    }
    throw new Error("a macro recording did not stop");
  }
  // U traverses same-line history beyond a single setup edit. A new handler makes
  // the row's own setup the complete history while preserving static registers.
  async function prepareLineUndo() {
    const previous = await code.probe.call("vimHistory");
    const beforeRegisters = await code.probe.call("registers");
    await code.probe.call("exec", { command: "toggleVim" });
    // toggleVim does not await its internal transition. Observe the disabled
    // handler map before resetting text, then observe the new Normal handler.
    let disabled;
    for (let i = 0; i < 40; i++) {
      disabled = await code.probe.call("vimState");
      if (disabled.handler === false && disabled.documents === 0) break;
      await sleep(50);
    }
    if (disabled?.handler !== false || disabled.documents !== 0)
      throw new Error(
        "line-undo preparation did not finish disabling VSCodeVim",
      );
    await code.probe.call("reset", START);
    await code.probe.call("exec", { command: "toggleVim" });
    let enabled;
    for (let i = 0; i < 40; i++) {
      enabled = await code.probe.call("vimState");
      if (
        enabled.state?.mode === "normal" &&
        enabled.state.pending?.length === 0
      )
        break;
      await sleep(50);
    }
    if (
      enabled?.state?.mode !== "normal" ||
      enabled.state.pending?.length !== 0
    )
      throw new Error("line-undo preparation did not restore Normal mode");
    const prepared = await code.probe.call("vimHistory");
    if (
      prepared.handler !== true ||
      prepared.depth !== 0 ||
      prepared.index !== -1 ||
      prepared.totalChanges !== 0 ||
      prepared.currentChanges !== 0 ||
      prepared.pendingContentChanges !== 0 ||
      prepared.currentDocumentMatches !== true
    )
      throw new Error(
        "line-undo preparation did not create empty document history",
      );
    const afterRegisters = await code.probe.call("registers");
    if (JSON.stringify(beforeRegisters) !== JSON.stringify(afterRegisters))
      throw new Error("line-undo preparation changed register contents");
    return { previous, prepared, registersPreserved: true };
  }
  // Every trial starts from Normal mode, the two files in their groups with a.txt active, no macro
  // being recorded, and the fixture text and cursor.
  async function resetTrial({
    clearJumps = false,
    alternateFile = false,
    windowTarget = false,
    clearScroll = false,
    clearLineUndo = false,
  } = {}) {
    typeKeys(display, RESET_KEYS, 30);
    await sleep(80);
    await code.probe.call("exec", { command: "expandLineSelection" });
    await sleep(150);
    typeKeys(display, ["<Esc>"], 30);
    await sleep(80);
    const snap = await code.probe.call("snapshot");
    const shows = (file, column) =>
      snap.editors.some(
        (e) => e.uri.endsWith(`/${file}`) && e.viewColumn === column,
      );
    if (
      snap.editors.length !== 2 ||
      !shows("a.txt", 1) ||
      !shows("b.txt", 2) ||
      !snap.active?.endsWith("/a.txt") ||
      snap.activeViewColumn !== 1
    ) {
      // Reopen the two files without closing anything: the sandbox has files.hotExit and
      // files.autoSave off, so closing the modified a.txt would raise a save prompt that blocks
      // the harness. A row that split a window leaves a third group: join the groups first,
      // which closes no editor.
      if (snap.editors.length !== 2)
        await code.probe.call("exec", {
          command: "workbench.action.joinAllGroups",
        });
      await code.probe.call("open", { files });
      focusWindow(code);
      await code.probe.call("exec", {
        command: "workbench.action.focusFirstEditorGroup",
      });
      await resetB();
    }
    // Keyboard focus and group 1's editors. <C-w> h runs navigateLeft (VSCodeVim 1.32.4
    // src/actions/commands/window.ts L71-L90), which from group 1 moves keyboard focus to the
    // Explorer while a.txt stays the active editor, so later keys went to the Explorer (pass 1:
    // the first 18 rows of the "a card after the <C-w> card). <C-6> opens b.txt in group 1 and the
    // reopen above only puts a.txt in front of it, so <C-pagedown> and <C-pageup>
    // (nextEditorInGroup, cmd_line/commands/tab.ts L182-L210) then switched to that hidden b.txt.
    // Every trial starts with keyboard focus in group 1 and a.txt as its only editor; b.txt is
    // open in group 2, so closing its other editor raises no save prompt.
    await code.probe.call("exec", {
      command: "workbench.action.focusFirstEditorGroup",
    });
    await code.probe.call("exec", {
      command: "workbench.action.closeOtherEditors",
    });
    await sleep(100);
    await stopRecording();
    const historyPreparation = clearLineUndo ? await prepareLineUndo() : null;
    // Ctrl-6 uses group 1's independent view state; window navigation uses group 2.
    const alternatePreparation = alternateFile
      ? await prepareTargetFile(1)
      : null;
    const windowPreparation = windowTarget ? await prepareTargetFile(2) : null;
    let scrollPreparation = null;
    if (clearScroll) {
      const previous = await code.probe.call("vimScroll");
      typeKeys(display, [":", ..."set scroll=0", "\n"], 30);
      await sleep(300);
      const prepared = await code.probe.call("vimScroll");
      if (prepared.scroll !== 0)
        throw new Error("the runtime scroll setting was not reset to zero");
      scrollPreparation = {
        previous: previous.scroll,
        scroll: prepared.scroll,
      };
    }
    // VSCodeVim keeps one jump list for the session (jumps/jumpTracker.ts), which the oracle's
    // fresh Vim does not have: a row that reads it starts with it cleared
    // (:clearjumps, cmd_line/commands/jumps.ts L51). Only those rows: the command line it runs
    // becomes the : register, which other rows may read.
    if (clearJumps) {
      typeKeys(display, [":", ..."clearjumps", "\n"], 30);
      await sleep(300);
    }
    await code.probe.call("reset", START);
    // The view (top line) and folds carry over from earlier rows (CTRL-E, CTRL-F, zt, zf, ...) and
    // decide keys such as H, M, L, CTRL-B and CTRL-U: every trial starts with the document's first
    // line at the top and no fold.
    await code.probe.call("exec", { command: "editor.unfoldAll" });
    await code.probe.call("exec", {
      command: "revealLine",
      args: [{ lineNumber: 0, at: "top" }],
    });
    await sleep(150);
    typeKeys(display, RESET_TAIL, 30);
    await sleep(200);
    // The reset ends in Normal mode. Measured (check1 triage, 2026-10-28): the first trial of a
    // session often stayed in Visual mode (the tail's <Esc> was lost), so the row's keys acted on a
    // one-character selection (`d 3 <CR>` deleted "w"); <Esc> again until the reader shows Normal
    // mode (3 tries). With VSCodeVim off the reader has no state and there is nothing to check.
    for (let i = 0; ; i++) {
      const st = (await code.probe.call("vimState")).state;
      if (!st || st.mode === "normal") break;
      if (i === 3) throw new Error(`the trial reset left mode ${st.mode}`);
      typeKeys(display, ["<Esc>"], 30);
      await sleep(200);
    }
    return {
      alternatePreparation,
      windowPreparation,
      scrollPreparation,
      historyPreparation,
    };
  }
  // A negative row (check1/unsupported.mjs): the row's token is one that nothing on Linux produces.
  // A trial sends, in the row's state, each chord a Linux user would press for it (card-keys.mjs
  // `tries`) while a macro is recorded, and reads which tokens VSCodeVim took: its pending keys (the
  // probe's test-only reader) and the keys of the recorded actions (probe macroActions). The trial
  // passes only when no chord delivered the token.
  async function negativeTrial(card, row, setupPlan) {
    const cardPlan = planKeys(card.keys);
    const tries = [];
    for (const chord of row.negative.tries) {
      await resetTrial();
      if (setupPlan) {
        await send(setupPlan);
        await sleep(200);
      }
      typeKeys(display, ["q", "z"], 30);
      await sleep(200);
      await send(cardPlan);
      execFileSync(
        "xdotool",
        ["key", "--clearmodifiers", "--delay", "30", ...chord],
        {
          env: { PATH: process.env.PATH, DISPLAY: display },
        },
      );
      await sleep(400);
      const st = await code.probe.call("vimState");
      const snap = await code.probe.call("snapshot");
      const pending = st.handler
        ? [
            ...st.fields.actionsRun.flatMap((a) => a.keysPressed),
            ...st.fields.actionKeys,
            ...st.fields.bufferedKeys,
          ]
        : [];
      if (!snap.active?.endsWith("/a.txt") || snap.activeViewColumn !== 1) {
        await code.probe.call("open", { files });
        focusWindow(code);
      }
      typeKeys(display, ["<Esc>", "<Esc>", "q"], 30);
      await sleep(400);
      await stopRecording();
      const macro = await code.probe.call("macroActions", { name: "z" });
      const received = [...pending, ...(macro ?? []).flatMap((a) => a.keys)];
      tries.push({
        chord,
        received,
        delivered: received.includes(row.negative.token),
        actions: macro ?? null,
        activeFile: snap.active?.replace(/^.*\//, ""),
      });
    }
    return tries;
  }
  for (const card of cards) {
    for (const row of card.rows.filter((r) => holds(r.when))) {
      if (row.negative) {
        const setupPlan = row.setup ? planKeys(row.setup) : null;
        for (let trial = 0; trial < Number(trialsArg); trial++) {
          const tries = await negativeTrial(card, row, setupPlan);
          const ok = tries.every((t) => !t.delivered);
          write({
            type: "trial",
            kind: "negative",
            card: card.id,
            key: row.key,
            token: row.negative.token,
            trial,
            ok,
            diff: ok ? [] : ["delivered"],
            tries,
          });
        }
        continue;
      }
      if (!row.expect) {
        write({ type: "no-expectation", card: card.id, key: row.key });
        continue;
      }
      // How the row's tokens are produced on Linux (card-keys.mjs). A row with a token that no key
      // or command produces on Linux is recorded once and not typed, so that it can never pass.
      const setupPlan = row.setup ? planKeys(row.setup) : null;
      const plan = planKeys([...card.keys, row.sample ?? row.key]);
      const blocked = [plan, setupPlan].filter(Boolean);
      if (blocked.some((p) => p.unreachable.length || p.untypeable.length)) {
        write({
          type: "untyped",
          card: card.id,
          key: row.key,
          unreachable: blocked.flatMap((p) => p.unreachable),
          untypeable: blocked.flatMap((p) => p.untypeable),
        });
        continue;
      }
      const clearJumps = [
        ...(row.setup ?? []),
        ...card.keys,
        row.sample ?? row.key,
      ].some(
        (k) =>
          JUMP_KEYS.has(k) &&
          // Ctrl-T aliases NavigateBack in Normal mode; Insert Ctrl-T indents instead.
          (k !== "<C-t>" || card.id.startsWith("normal ")),
      );
      for (let trial = 0; trial < Number(trialsArg); trial++) {
        const {
          alternatePreparation,
          windowPreparation,
          scrollPreparation,
          historyPreparation,
        } = await resetTrial({
          clearJumps,
          alternateFile: row.key === "<C-6>",
          windowTarget:
            card.id === 'normal ["<C-w>"]' &&
            !row.setup?.length &&
            WINDOW_TARGET_KEYS.has(row.key),
          clearScroll: needsScrollPreparation(card, row),
          clearLineUndo: needsLineUndoPreparation(card, row),
        });
        const before = await code.probe.call("registers");
        if (
          (alternatePreparation || windowPreparation) &&
          (!sameReg(regValue(before["%"]), {
            mode: "character",
            lines: ["a.txt"],
          }) ||
            !sameReg(regValue(before["#"]), {
              mode: "character",
              lines: ["b.txt"],
            }))
        )
          throw new Error("target-file register baseline was not restored");
        // A row may set up a precondition (such as a mark) after the reset and before the card's keys.
        if (setupPlan) {
          await send(setupPlan);
          await sleep(200);
        }
        let beforeViewport = null;
        if (["<C-d>", "<C-u>", "<C-y>"].includes(row.key)) {
          const snap = await code.probe.call("snapshot");
          const editor = snap.editors.find(
            (e) =>
              e.uri === snap.active && e.viewColumn === snap.activeViewColumn,
          );
          beforeViewport = {
            file: snap.active?.replace(/^.*\//, "") ?? null,
            viewColumn: snap.activeViewColumn,
            visibleRanges: editor?.visibleRanges ?? null,
            scroll: (await code.probe.call("vimScroll")).scroll,
          };
        }
        const typed = [...card.keys, row.sample ?? row.key];
        await send(plan);
        await sleep(400);
        const snap = await code.probe.call("snapshot");
        const active =
          snap.editors.find(
            (e) =>
              e.uri === snap.active && e.viewColumn === snap.activeViewColumn,
          ) ?? snap.editors.find((e) => e.uri === snap.active);
        const state = (await code.probe.call("vimState")).state;
        let mode = state?.mode ?? null;
        let modeFrom = "reader";
        if (!state) {
          const status = (
            await cdpEvaluate(Number(cdpPort), STATUS_BAR_JS)
          ).map((x) => x[1]);
          if (status.includes(DISABLED_TEXT)) {
            mode = DISABLED_MODE;
            modeFrom = "status bar";
          } else modeFrom = "none";
        }
        const after = await code.probe.call("registers");
        // expect.shiftNumbered: the key shifts the numbered registers (:help quote_number), so
        // register n+1 must hold what register n held before, for n = 1..8.
        const expectedRegisters = Object.fromEntries(
          Object.entries(row.expect.registers ?? {}).map(([k, v]) => [
            k,
            canon(v),
          ]),
        );
        if (row.expect.shiftNumbered) {
          for (let n = 8; n >= 1; n--) {
            const prev = regValue(before[String(n)]);
            if (prev !== undefined)
              expectedRegisters[String(n + 1)] = canon(prev);
          }
        }
        const historyPicker = row.expect.quickPick
          ? await cdpEvaluate(Number(cdpPort), HISTORY_PICKER_JS)
          : null;
        const got = {
          ...(historyPicker ? { quickPick: historyPicker } : {}),
          text: active ? active.text.replace(/\n$/, "").split("\n") : null,
          cursor: active ? active.selections[0].slice(2) : null,
          mode,
          registers: Object.fromEntries(
            [...new Set([...Object.keys(before), ...Object.keys(after)])]
              .filter(
                (k) =>
                  k in expectedRegisters ||
                  !sameRegNamed(k, regValue(before[k]), regValue(after[k])),
              )
              .map((k) => [k, canon(regValue(after[k])) ?? null]),
          ),
        };
        // Registers named in the expectation must hold the given value; every other register must
        // hold what it held before the key.
        const want = {
          ...(row.expect.quickPick
            ? { quickPick: { visible: true, ...row.expect.quickPick } }
            : {}),
          text: expectedText(row.expect),
          cursor: row.expect.cursor,
          mode: row.expect.mode,
          registers: expectedRegisters,
        };
        const sortEntries = (o) => JSON.stringify(Object.entries(o).sort());
        const diff = [
          [
            "quickPick",
            JSON.stringify(got.quickPick) !== JSON.stringify(want.quickPick),
          ],
          ["text", JSON.stringify(got.text) !== JSON.stringify(want.text)],
          [
            "cursor",
            JSON.stringify(got.cursor) !== JSON.stringify(want.cursor),
          ],
          ["mode", got.mode !== want.mode],
          [
            "registers",
            sortEntries(got.registers) !== sortEntries(want.registers),
          ],
        ]
          .filter(([, d]) => d)
          .map(([k]) => k);
        write({
          type: "trial",
          card: card.id,
          key: row.key,
          typed,
          sent: plan.steps.map((st) =>
            st.keys ? { keys: st.keys.map(keysym) } : { exec: st.exec },
          ),
          trial,
          ...(alternatePreparation ? { alternatePreparation } : {}),
          ...(windowPreparation ? { windowPreparation } : {}),
          ...(scrollPreparation ? { scrollPreparation } : {}),
          ...(beforeViewport ? { beforeViewport } : {}),
          ...(historyPreparation ? { historyPreparation } : {}),
          ok: diff.length === 0,
          diff,
          got,
          want,
          // Full register snapshots let a later, independently authored expectation be checked
          // without guessing whether an omitted register changed or stayed unchanged.
          beforeRegisters: Object.fromEntries(
            Object.entries(before).map(([k, v]) => [k, canon(regValue(v))]),
          ),
          afterRegisters: Object.fromEntries(
            Object.entries(after).map(([k, v]) => [k, canon(regValue(v))]),
          ),
          activeFile: snap.active?.replace(/^.*\//, ""),
          activeViewColumn: snap.activeViewColumn,
          knownDeviation: row.knownDeviation ?? null,
          modeFrom,
        });
        // A row whose token ran a command (such as toggleVim) undoes it before the next trial.
        for (const command of plan.teardown) {
          await code.probe.call("exec", { command });
          await sleep(600);
        }
      }
    }
  }
  write({ type: "end", finished: new Date().toISOString() });
} catch (e) {
  write({
    type: "error",
    phase,
    version,
    set,
    build,
    error: portable(e.stack ?? e),
  });
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
