// A separate timing condition for the counted leader: after a 300 ms stabilization interval,
// the timer's first callback checks the root once. Renderer scheduling can delay that callback;
// its actual time is recorded. This is not proof that which-key has finished asynchronous work.
// Later root redraws still fail the run.
import { typeKeys } from "./lib.mjs";
import { typeKeysSettling } from "./whichkey-settle.mjs";

export const COUNT_LEADER_DELAY_MS = 300;
const KEYS = ["3", "<Space>", "b", "n"];

export function countLeaderProblems(record) {
  const problems = [];
  if (record?.delayMs !== COUNT_LEADER_DELAY_MS)
    problems.push("wrong stabilization interval");
  if (!record?.ready?.ok) problems.push("root not ready at the fixed deadline");
  if (!(record?.ready?.afterSpaceMs >= COUNT_LEADER_DELAY_MS))
    problems.push("readiness sampled before the fixed deadline");
  if (
    JSON.stringify(record?.keys?.map((x) => x.key)) !==
    JSON.stringify(["3", " ", "b", "n"])
  )
    problems.push("the renderer did not observe the complete key sequence");
  if (!(record?.spaceToBMs >= COUNT_LEADER_DELAY_MS))
    problems.push("b arrived before the stabilization interval ended");
  if (record?.keys?.slice(2).some((x) => !x.inQuick))
    problems.push("a menu key was dispatched outside quick input");
  if (record?.rootRedraws?.length) problems.push("root redrawn after b");
  if (record?.overflow) problems.push("renderer observation overflow");
  return problems;
}

// The renderer captures the timer callback's state. A delayed CDP response cannot replace it
// with a later observation, and a failed observation is never polled again for readiness.
const installMonitor = (rootRows) => `(() => {
  const expected = ${JSON.stringify(rootRows)};
  const delayMs = ${COUNT_LEADER_DELAY_MS};
  const started = performance.now();
  const result = { delayMs, ready: null, keys: [], states: [], rootRedraws: [], overflow: false };
  let spaceAt, bAt, timer, resolveReady, lastState, disposed = false;
  const snapshot = () => {
    const w = document.querySelector('.quick-input-widget');
    const hidden = !w || getComputedStyle(w).display === 'none';
    const closing = !!w && w.classList.contains('quick-input-widget-closing');
    const inQuick = !!w && w.contains(document.activeElement);
    const input = w && w.querySelector('input');
    const value = input ? input.value : null;
    const rows = w ? [...w.querySelectorAll('.monaco-list-row')].map(x => x.textContent.trim().replace(/\\s+/g, ' ')) : [];
    const root = JSON.stringify(rows) === JSON.stringify(expected);
    return { hidden, closing, inQuick, value, rows, root };
  };
  const observe = () => {
    const state = snapshot();
    const signature = JSON.stringify(state);
    if (signature === lastState) return;
    lastState = signature;
    const entry = { ms: performance.now() - started, ...state };
    if (result.states.length < 64) result.states.push(entry); else result.overflow = true;
    if (bAt !== undefined && state.root && state.value === '' && !state.hidden)
      result.rootRedraws.push(entry);
  };
  const keydown = event => {
    const now = performance.now();
    if (result.keys.length < 8)
      result.keys.push({ key: event.key, ms: now - started, inQuick: snapshot().inQuick });
    else result.overflow = true;
    if (event.key === ' ' && spaceAt === undefined) {
      spaceAt = now;
      timer = setTimeout(() => {
        const state = snapshot();
        result.ready = { afterSpaceMs: performance.now() - spaceAt, ...state,
          ok: !state.hidden && !state.closing && state.inQuick && state.value === '' && state.root };
        if (resolveReady) resolveReady(result.ready);
      }, delayMs);
    }
    if (event.key === 'b' && bAt === undefined) bAt = now;
  };
  const observer = new MutationObserver(observe);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener('keydown', keydown, true);
  observe();
  window.__s2CountLeader = {
    wait: () => result.ready ? Promise.resolve(result.ready) : new Promise(resolve => { resolveReady = resolve; }),
    finish: () => {
      if (!disposed) {
        observe();
        observer.disconnect();
        document.removeEventListener('keydown', keydown, true);
        clearTimeout(timer);
        disposed = true;
      }
      const space = result.keys.find(x => x.key === ' ');
      const b = result.keys.find(x => x.key === 'b');
      const n = result.keys.find(x => x.key === 'n');
      result.spaceToBMs = space && b ? b.ms - space.ms : null;
      result.bToNMs = b && n ? n.ms - b.ms : null;
      return result;
    }
  };
  return true;
})()`;

export async function typeCountedLeader(
  display,
  keys,
  delayMs,
  matcher,
  context,
) {
  if (
    JSON.stringify(keys) !== JSON.stringify(KEYS) ||
    context.rule !== "effect"
  )
    throw new Error(
      "the stabilization condition is only for 3 SPC b n with the effect rule",
    );
  const { watcher } = context;
  const rootRows = matcher.root.map(
    (x) => `${x.key === " " ? "␣" : x.key} ${x.name}`,
  );
  await watcher.evaluate(installMonitor(rootRows));
  const finish = () => watcher.evaluate("window.__s2CountLeader.finish()");
  try {
    if (matcher.feed(keys[0]) !== null || matcher.feed(keys[1]) !== "open")
      throw new Error("counted leader did not start outside a which-key path");
    typeKeys(display, keys.slice(0, 2), delayMs);
    const ready = await watcher.evaluate(
      "(async () => { let timer; try { return await Promise.race([window.__s2CountLeader.wait(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Space keydown was not observed')), 2000); })]); } finally { clearTimeout(timer); } })()",
      true,
    );
    if (!ready?.ok)
      throw new Error(
        "counted-leader root was not ready at the 300 ms deadline",
      );
    const waits = await typeKeysSettling(
      display,
      keys.slice(2),
      delayMs,
      matcher,
      context,
    );
    const record = await finish();
    const problems = countLeaderProblems(record);
    if (problems.length)
      throw Object.assign(new Error(problems.join("; ")), {
        countLeader: record,
      });
    for (const wait of waits) wait.index += 2;
    waits[0].countLeader = record;
    return waits;
  } catch (error) {
    error.countLeader ??= await finish();
    throw error;
  }
}
