import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

export function keyParameters(value) {
  const special = {
    space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
    Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    slash: { key: "/", code: "Slash", windowsVirtualKeyCode: 191, text: "/" },
    plus: {
      key: "+",
      code: "Equal",
      windowsVirtualKeyCode: 187,
      modifiers: 8,
      text: "+",
    },
    "ctrl+bracketleft": {
      key: "[",
      code: "BracketLeft",
      windowsVirtualKeyCode: 219,
      modifiers: 2,
    },
  };
  if (special[value]) return special[value];
  assert.match(value, /^[a-z]$/);
  return {
    key: value,
    code: "Key" + value.toUpperCase(),
    windowsVirtualKeyCode: value.toUpperCase().charCodeAt(0),
    text: value,
  };
}

export function cdpInput(observer, delay) {
  let nextAt = 0;
  async function interval() {
    await sleep(Math.max(0, nextAt - performance.now()));
    nextAt = performance.now() + delay;
  }
  return {
    async key(value) {
      await interval();
      const parameters = keyParameters(value);
      await observer.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        ...parameters,
      });
      const { text, ...up } = parameters;
      await observer.send("Input.dispatchKeyEvent", { type: "keyUp", ...up });
    },
    async compose(stages, { processKey = false, codes = [] } = {}) {
      for (const [index, text] of stages.entries()) {
        await interval();
        const key = {
          key: "Process",
          code: codes[index] ?? "KeyG",
          windowsVirtualKeyCode: 229,
        };
        if (processKey)
          await observer.send("Input.dispatchKeyEvent", {
            type: "keyDown",
            ...key,
          });
        await observer.send("Input.imeSetComposition", {
          text,
          selectionStart: text.length,
          selectionEnd: text.length,
        });
        if (processKey)
          await observer.send("Input.dispatchKeyEvent", {
            type: "keyUp",
            ...key,
          });
      }
      await observer.send("Input.insertText", { text: stages.at(-1) });
    },
  };
}

export async function proveCdp({
  result,
  observer,
  call,
  settled,
  noPending,
  text,
}) {
  const input = cdpInput(observer, result.condition.delayMs);
  const pattern = [
    "space",
    "w",
    "h",
    "j",
    "a",
    "b",
    "c",
    "slash",
    "plus",
    "Escape",
    "ctrl+bracketleft",
  ];
  const keys = Array.from(
    { length: 1000 },
    (_, index) => pattern[index % pattern.length],
  );
  await call("delivery", { enabled: true });
  for (const key of keys) await input.key(key);
  await sleep(100);
  const observed = await call("delivery", { enabled: false });
  result.cdpDelivery = { expected: keys, observed };
  assert.deepEqual(
    observed.map((item) => item.key),
    keys,
    "CDP delivery loss/extra/reordering",
  );
  await call("text", { value: "" });
  await settled();
  const script = "abcdefghij".repeat(100);
  await input.key("i");
  for (const key of script) await input.key(key);
  await input.key("Escape");
  const after = await settled();
  result.cdpScript = { expected: script, observed: after };
  assert.equal(after.text, script);
  assert.equal(after.mode, 0);
  assert.ok(noPending(after));
  await call("text", { value: "" });
  await settled();
  await input.key("i");
  const insertMode = await settled();
  assert.equal(
    insertMode.mode,
    1,
    "composition proof did not enter Insert mode",
  );
  await observer.begin();
  await input.compose(["ㅎ", "하", "한"], { processKey: true });
  const firstComposition = await settled();
  await input.compose(["ㄱ", "그", "글"]);
  const secondComposition = await settled();
  await input.key("Escape");
  const composition = await settled();
  result.cdpCompositionProof = {
    expected: "한글",
    insertMode,
    firstComposition,
    secondComposition,
    renderer: await observer.read(),
    observed: composition,
  };
  assert.equal(
    composition.text,
    "한글",
    "CDP compositions did not reach the editor",
  );
  assert.equal(composition.mode, 0);
  await call("text", { value: text });
  await settled();
}
