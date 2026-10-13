import { describe, expect, test } from "vitest";
import { whichKeyArgs } from "../tools/core/gen.mts";

describe("whichKeyArgs", () => {
  test("passes one truthy argument that is not a list as itself and any other arguments as a list", () => {
    // which-key 0.11.4 and VSCodeVim spread a list into positional arguments and drop a falsy one.
    expect([
      whichKeyArgs([]),
      whichKeyArgs(["@"]),
      whichKeyArgs([{ kind: "refactor" }]),
      whichKeyArgs(["a", 2]),
      whichKeyArgs([["a", "b"]]),
      whichKeyArgs([0]),
      whichKeyArgs([""]),
      whichKeyArgs([false]),
      whichKeyArgs([null]),
    ]).toStrictEqual([
      {},
      { args: "@" },
      { args: { kind: "refactor" } },
      { args: ["a", 2] },
      { args: [["a", "b"]] },
      { args: [0] },
      { args: [""] },
      { args: [false] },
      { args: [null] },
    ]);
  });
});
