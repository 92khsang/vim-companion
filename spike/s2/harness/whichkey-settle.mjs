// Opt-in settle rule for the differential harness (S2_WHICHKEY_SETTLE=1): after a typed key
// completes a which-key binding path (a leaf, not a submenu prefix), the harness waits until the
// quick input widget of the renderer is hidden before it types the next key, with a cap. which-key
// 0.11.4 hides its quick pick (`await this.hide()`, which waits for the quick pick's onDidHide) and
// only then runs the leaf's command; that hide travels from the extension host to the renderer
// asynchronously, so a key typed 30 ms after the leaf sometimes reaches the closing quick pick and
// sometimes the editor.
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

export const SETTLE_CAP_MS = 1000;
const POLL_SLEEP_MS = 4;

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
  /** Polls until the quick input widget is hidden or the cap elapses. */
  async waitHidden(capMs = SETTLE_CAP_MS) {
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
          // Both versions close the widget with a 150 ms animation (class
          // quick-input-widget-closing, pointer-events none) and set display none at its end,
          // while the focus goes back to the editor when the animation starts; the first poll
          // records both, so that the wait can be read against the focus.
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

/**
 * Types the keys with the given delay as the plain typeKeys does, except that the burst ends after
 * a key that completes a which-key path, and the next burst starts once the quick input widget is
 * hidden (or the cap elapsed). xdotool sleeps the delay after every key including the last, so the
 * key after a leaf comes at least the delay plus the wait after the leaf. Returns one record per
 * wait: the key index, the path, the wait, and the gap from the end of the leaf burst to the start
 * of the next burst (or the end of the item).
 */
export async function typeKeysSettling(
  display,
  keys,
  delayMs,
  matcher,
  watcher,
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
    typeKeys(display, burst, delayMs);
    const t = Date.now();
    const rec = {
      index,
      key,
      path: matcher.path.join(" "),
      ...(await watcher.waitHidden()),
    };
    waits.push(rec);
    last = { rec, t };
    burst = [];
  }
  resume();
  if (burst.length) typeKeys(display, burst, delayMs);
  return waits;
}
