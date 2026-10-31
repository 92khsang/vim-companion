import test from "node:test";
import assert from "node:assert/strict";
import { cdpInput, keyParameters } from "./cdp-input.mjs";
import { compositionDeadline } from "./hangul.mjs";

test("CDP composition variants preserve the process-key distinction", async () => {
  const commands = [];
  const input = cdpInput(
    {
      send: async (method, parameters) =>
        commands.push({ method, ...parameters }),
    },
    0,
  );
  await input.compose(["ㅎ"]);
  assert.deepEqual(
    commands.map((item) => item.method),
    ["Input.imeSetComposition", "Input.insertText"],
  );
  commands.length = 0;
  await input.compose(["ㅎ"], { processKey: true });
  assert.deepEqual(
    commands.map((item) => item.method),
    [
      "Input.dispatchKeyEvent",
      "Input.imeSetComposition",
      "Input.dispatchKeyEvent",
      "Input.insertText",
    ],
  );
  assert.ok(
    commands
      .filter((item) => item.method === "Input.dispatchKeyEvent")
      .every((item) => item.windowsVirtualKeyCode === 229),
  );
  assert.equal(keyParameters("ctrl+bracketleft").modifiers, 2);
  assert.equal(keyParameters("plus").modifiers, 8);
});

test("composition deadline never expands the five-second threshold", () => {
  const events = [
    { type: "start", t: 10 },
    { type: "release-request", t: 5009.9 },
    { type: "end", t: 5010.1, reason: "watchdog" },
  ];
  assert.equal(compositionDeadline(events).outcome, "inconclusive");
  events[1].t = 5010.01;
  assert.equal(compositionDeadline(events).outcome, "fail");
  events[1].t = 5009;
  events[2].t = 5010;
  assert.equal(compositionDeadline(events).outcome, "pass");
});
