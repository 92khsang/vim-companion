// Opt-in settle rules for the differential harness. After a typed key completes a which-key
// binding path (a leaf, not a submenu prefix), the harness types nothing until the rule's condition
// holds, then types the rest of the burst with the usual delay. which-key 0.11.4 hides its quick
// pick (`await this.hide()`, which waits for the quick pick's onDidHide) and only then runs the
// leaf's command; VS Code's quick input hide() refocuses the editor that opened the pick first. A
// key typed 30 ms after the leaf therefore sometimes reaches the closing quick pick or the editor
// that opened it, and sometimes the editor that the command moves to.
//
// - S2_WHICHKEY_SETTLE=1 (or `effect`): the effect rule. The harness waits until the leaf
//   command's effect is observed through the probe (the active editor and its group), capped at
//   EFFECT_CAP_MS; a missing effect throws, so the run ends as a run-error record. The expected
//   effect follows from the leaf's command and the state before the leaf: a group move expects the
//   active editor of the neighbouring group; a move that has no target (no group on that side, one
//   editor in the group) expects no change, and the wait then ends when the quick input widget is
//   closing or hidden and the focus is out of it, because a command that changes nothing cannot
//   send a later key elsewhere. A leaf command without a rule throws.
// - S2_WHICHKEY_SETTLE=hidden: the earlier rule, which waits until the widget is hidden (cap
//   HIDDEN_CAP_MS); it reproduces the committed `off-only-<version>-settle.jsonl` runs.
//
// The matcher is syntactic: it walks the generated which-key bindings with the typed keys and does
// not know VSCodeVim's state. A leader that VSCodeVim consumes as a character argument or a motion
// (`f <Space>`, `d <Space>`) still opens a path in the matcher; a leaf reached on such a false path
// costs one read that finds the widget hidden. Only a leader (a remap whose single command is
// whichkey.show) opens a path; inside a path a key is looked up in the open menu: a submenu key
// descends, a leaf key ends the path and asks for the wait, any other key (a mismatch, <Esc>, a
// chord) ends the path without a wait, because which-key resolves or the quick input closes on it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { REPO, typeKeys } from "./lib.mjs";

export const HIDDEN_CAP_MS = 1000;
export const EFFECT_CAP_MS = 2000;
// Kept for the records of the hidden rule.
export const SETTLE_CAP_MS = HIDDEN_CAP_MS;
const POLL_SLEEP_MS = 4;

// The effects of the leaf commands that the differential script reaches (spec/generated/vscode/
// whichkey-bindings.json): `SPC w h` and `SPC w l` move between editor groups; `SPC b n` and
// `SPC b p` move between the editors of the active group.
const GROUP_MOVES = {
  "workbench.action.focusLeftGroup": -1,
  "workbench.action.focusRightGroup": 1,
};
const EDITOR_MOVES = new Set([
  "workbench.action.nextEditorInGroup",
  "workbench.action.previousEditorInGroup",
]);

// Harness key notation (lib.mjs keysym) to the `key` field of a which-key binding.
const toWhichKey = (key) => {
  if (key === "<Space>") return " ";
  if (key === "<Tab>") return "\t";
  return key.length === 1 ? key : undefined;
};
// VSCodeVim remap notation to the harness notation.
const leaderKey = (before) =>
  before.length === 1 && before[0].toLowerCase() === "<space>"
    ? "<Space>"
    : undefined;

/** Reads the generated remaps and bindings: the leader keys and the binding tree. */
export function loadWhichKey() {
  const remaps = JSON.parse(
    readFileSync(join(REPO, "spec/generated/vscode/vim-remaps.json"), "utf8"),
  );
  const bindings = JSON.parse(
    readFileSync(
      join(REPO, "spec/generated/vscode/whichkey-bindings.json"),
      "utf8",
    ),
  );
  const leaders = new Set();
  for (const list of Object.values(remaps)) {
    for (const r of list) {
      if (r.commands?.length === 1 && r.commands[0] === "whichkey.show") {
        const k = leaderKey(r.before);
        if (!k) throw new Error(`unsupported leader ${r.before.join(" ")}`);
        leaders.add(k);
      }
    }
  }
  if (leaders.size === 0) throw new Error("no whichkey.show remap");
  return { leaders, bindings };
}

export class WhichKeyMatcher {
  constructor({ leaders, bindings }) {
    this.leaders = leaders;
    this.root = bindings;
    this.menu = null; // the bindings of the open menu, or null outside which-key
    this.path = []; // the keys of the open path, for the record
  }
  /** Feeds one typed key; returns "open", "menu", "leaf" or "close", or null outside which-key. */
  feed(key) {
    if (this.menu === null) {
      if (!this.leaders.has(key)) return null;
      this.menu = this.root;
      this.path = [key];
      return "open";
    }
    this.path.push(key);
    const k = toWhichKey(key);
    const b = k === undefined ? undefined : this.menu.find((x) => x.key === k);
    if (b?.bindings) {
      this.menu = b.bindings;
      return "menu";
    }
    this.menu = null;
    this.leaf = b ?? null; // the binding of the leaf, for the effect rule
    return b ? "leaf" : "close";
  }
}

/** One CDP connection to the workbench page, kept open for repeated reads. */
export class QuickInputWatcher {
  static async connect(port) {
    const list = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const page = list.find((t) => t.type === "page" && /workbench/.test(t.url));
    if (!page) throw new Error("no workbench page");
    const w = new QuickInputWatcher();
    w.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => ((w.ws.onopen = r), (w.ws.onerror = j)));
    w.nextId = 1;
    w.pending = new Map();
    w.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const p = w.pending.get(msg.id);
      if (!p) return;
      w.pending.delete(msg.id);
      msg.error
        ? p.reject(new Error(msg.error.message))
        : p.resolve(msg.result.result.value);
    };
    return w;
  }
  evaluate(expression) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    });
  }
  /** { hidden, active }: whether the quick input widget is hidden, and the focused element. */
  read() {
    return this.evaluate(QUICK_INPUT_JS);
  }
  /** { groups, activeIndex, tabs }: editor groups and the tabs of the active one (renderer DOM). */
  groups() {
    return this.evaluate(GROUPS_JS);
  }
  /** Polls until the quick input widget is hidden or the cap elapses (the hidden rule). */
  async waitHidden(capMs = HIDDEN_CAP_MS) {
    const t0 = Date.now();
    let polls = 0;
    let first;
    for (;;) {
      const r = await this.read();
      polls++;
      first ??= r;
      if (r.hidden || Date.now() - t0 >= capMs) {
        return {
          waitMs: Date.now() - t0,
          polls,
          hidden: r.hidden,
          visibleAtFirstPoll: !first.hidden,
          // Both workbench bundles carry a 150 ms closing animation (class
          // quick-input-widget-closing, pointer-events none) that ends in display none. In the
          // recorded runs 1.141.0 showed the class at the first poll in 20 of 20 waits, while
          // 1.134.0 was already hidden at the first poll in 20 of 20. The hidden-widget wait works
          // on 1.141.0 because the animation outlasts the command and waits 1 to 5 ms on 1.134.0;
          // the effect rule below does not depend on the animation.
          closingAtFirstPoll: first.closing,
          focusInQuickAtFirstPoll: first.inQuick,
          active: r.active,
        };
      }
      await sleep(POLL_SLEEP_MS);
    }
  }
  close() {
    this.ws?.close();
  }
}

// VS Code's quick input controller sets `display: none` on `.quick-input-widget` in hide() and
// clears it in show(); before the first show the widget does not exist.
const QUICK_INPUT_JS = `(() => {
  const w = document.querySelector('.quick-input-widget');
  const hidden = !w || getComputedStyle(w).display === 'none';
  const a = document.activeElement;
  const active = a ? a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).trim().split(/\\s+/).slice(0, 2).join('.') : '') : null;
  const closing = Boolean(w) && w.classList.contains('quick-input-widget-closing');
  const inQuick = Boolean(w) && w.contains(a);
  return { hidden, active, closing, inQuick };
})()`;

// The editor groups of the workbench and the tabs of the active group.
const GROUPS_JS = `(() => {
  const groups = [...document.querySelectorAll('.editor-group-container')];
  const active = document.querySelector('.editor-group-container.active');
  const tabs = active ? active.querySelectorAll('.tabs-container > .tab').length : -1;
  return { groups: groups.length, activeIndex: groups.indexOf(active), tabs };
})()`;

/**
 * The active editor over time, from the probe: a snapshot at sync() gives the active editor and
 * the group (viewColumn) of every visible editor, and the probe's `active` events give the later
 * changes. A file shown in two groups at once would make the group of an event ambiguous, so
 * sync() refuses it. With keepEvents (the trace mode, which clears the probe's events itself) the
 * events are read without clearing them.
 */
export class EditorTracker {
  constructor(probe, { keepEvents = false } = {}) {
    this.probe = probe;
    this.keepEvents = keepEvents;
  }
  async sync() {
    const s = await this.probe.call("snapshot");
    this.columns = new Map();
    for (const e of s.editors) {
      if (this.columns.has(e.uri) && this.columns.get(e.uri) !== e.viewColumn)
        throw new Error(`${e.uri} is visible in two editor groups`);
      this.columns.set(e.uri, e.viewColumn);
    }
    await this.probe.call("events", { clear: true });
    this.seen = 0;
    this.timeline = [
      { t: Date.now(), uri: s.active, viewColumn: s.activeViewColumn },
    ];
  }
  async poll() {
    const ev = await this.probe.call(
      "events",
      this.keepEvents ? {} : { clear: true },
    );
    if (this.keepEvents && ev.length < this.seen) this.seen = 0;
    const fresh = this.keepEvents ? ev.slice(this.seen) : ev;
    this.seen = this.keepEvents ? ev.length : 0;
    for (const e of fresh)
      if (e.type === "active")
        this.timeline.push({
          t: e.t,
          uri: e.uri,
          viewColumn: e.uri ? (this.columns.get(e.uri) ?? null) : null,
        });
  }
  /** The active editor just before time t. */
  before(t) {
    return this.timeline.filter((x) => x.t < t).at(-1) ?? this.timeline[0];
  }
  /** The changes of the active editor at or after time t. */
  since(t) {
    return this.timeline.filter((x) => x.t >= t);
  }
}

const base = (uri) => uri?.replace(/^.*\//, "") ?? null;
const at = (x) => (x ? `${base(x.uri)}:${x.viewColumn}` : null);

/**
 * The effect rule: polls until the leaf command's effect is observed, then returns the record of
 * the wait; throws when it is not observed within the cap. tLeaf is the earliest time at which the
 * leaf can have been typed (the start of its burst plus its index times the key delay): the state
 * before it is the state the command starts from, and only changes at or after it count.
 */
async function waitEffect({ watcher, tracker, binding, path, tLeaf }) {
  const command =
    binding.command ?? (binding.commands ?? []).join(",") ?? String(binding);
  const t0 = Date.now();
  let polls = 0;
  for (;;) {
    await tracker.poll();
    polls++;
    const from = tracker.before(tLeaf);
    const changes = tracker.since(tLeaf);
    let expected;
    let observed = null;
    if (command in GROUP_MOVES) {
      const dir = GROUP_MOVES[command];
      const cols = [...new Set(tracker.columns.values())].sort((a, b) => a - b);
      const side = cols.filter((c) =>
        dir < 0 ? c < from.viewColumn : c > from.viewColumn,
      );
      const target = dir < 0 ? side.at(-1) : side[0];
      if (target === undefined)
        expected = `no change: no group ${dir < 0 ? "left" : "right"} of group ${from.viewColumn}`;
      else {
        expected = `active editor in group ${target}`;
        observed = changes.find((x) => x.viewColumn === target) ?? null;
      }
    } else if (EDITOR_MOVES.has(command)) {
      const g = await watcher.groups();
      if (g.tabs !== 1)
        throw new Error(
          `which-key leaf ${path}: ${command} with ${g.tabs} tabs in the active group has no effect rule`,
        );
      expected = `no change: one editor in group ${from.viewColumn}`;
    } else
      throw new Error(`which-key leaf ${path}: no effect rule for ${command}`);
    const q = await watcher.read();
    const none = expected.startsWith("no change");
    if (none && changes.length)
      throw new Error(
        `which-key leaf ${path}: expected ${expected} from ${at(from)}, saw ${changes.map(at).join(", ")}`,
      );
    const done = none
      ? (q.hidden || q.closing) && !q.inQuick
      : Boolean(observed);
    if (done)
      return {
        rule: "effect",
        command,
        from: at(from),
        expected,
        observed: observed ? at(observed) : "no change",
        eventAfterLeafMs: observed ? observed.t - tLeaf : null,
        changes: changes.length,
        waitMs: Date.now() - t0,
        polls,
        quickVisible: !q.hidden,
        quickClosing: q.closing,
        focusInQuick: q.inQuick,
        active: q.active,
      };
    if (Date.now() - t0 >= EFFECT_CAP_MS)
      throw new Error(
        `which-key leaf ${path}: ${command} expected ${expected} from ${at(from)}; not observed within ${EFFECT_CAP_MS} ms (changes: ${changes.map(at).join(", ") || "none"}; quick input hidden ${q.hidden}, closing ${q.closing}, focus in it ${q.inQuick})`,
      );
    await sleep(POLL_SLEEP_MS);
  }
}

/**
 * Types the keys with the given delay as the plain typeKeys does, except that the burst ends after
 * a key that completes a which-key path, and the next burst starts once the rule's condition holds
 * (rule `effect`: the leaf command's effect, see waitEffect; rule `hidden`: the quick input widget
 * is hidden or the cap elapsed). xdotool sleeps the delay after every key including the last, so
 * the key after a leaf comes at least the delay plus the wait after the leaf. Returns one record per
 * wait: the key index, the path, the wait, and the gap from the end of the leaf burst to the start
 * of the next burst (or the end of the item).
 */
export async function typeKeysSettling(
  display,
  keys,
  delayMs,
  matcher,
  { watcher, tracker, rule = "effect" },
) {
  const waits = [];
  let burst = [];
  let last; // the last wait, to fill its gap when typing resumes
  const resume = () => {
    if (last) last.rec.gapMs = Date.now() - last.t;
    last = undefined;
  };
  for (const [index, key] of keys.entries()) {
    burst.push(key);
    if (matcher.feed(key) !== "leaf") continue;
    resume();
    const path = matcher.path.join(" ");
    const tLeaf = Date.now() + (burst.length - 1) * delayMs;
    typeKeys(display, burst, delayMs);
    const t = Date.now();
    const rec = {
      index,
      key,
      path,
      ...(rule === "hidden"
        ? await watcher.waitHidden()
        : await waitEffect({
            watcher,
            tracker,
            binding: matcher.leaf,
            path,
            tLeaf,
          })),
    };
    waits.push(rec);
    last = { rec, t };
    burst = [];
  }
  resume();
  if (burst.length) typeKeys(display, burst, delayMs);
  return waits;
}
