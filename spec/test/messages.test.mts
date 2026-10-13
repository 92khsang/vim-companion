import { describe, expect, test } from "vitest";
import { prefixLines, thrownMessage } from "../tools/core/messages.mts";

describe("prefixLines", () => {
  test("puts the prefix before each line of each message, in order", () => {
    expect(
      prefixLines("check-ids: ", [
        "spec/ids/vscode.json: /commands: must be array",
        "spec/catalog/commands/search.json: Unexpected token 'x', ...\"s\": [\n    x\n  ]",
      ]),
    ).toEqual([
      "check-ids: spec/ids/vscode.json: /commands: must be array",
      "check-ids: spec/catalog/commands/search.json: Unexpected token 'x', ...\"s\": [",
      "check-ids:     x",
      "check-ids:   ]",
    ]);
  });

  test("gives no lines for no messages", () => {
    expect(prefixLines("gen: ", [])).toEqual([]);
  });
});

describe("thrownMessage", () => {
  test("is the message of an Error and the text of any other thrown value", () => {
    expect([
      thrownMessage(new SyntaxError("Unexpected end of JSON input")),
      thrownMessage("unzip is missing"),
      thrownMessage(2),
      thrownMessage(undefined),
    ]).toEqual([
      "Unexpected end of JSON input",
      "unzip is missing",
      "2",
      "undefined",
    ]);
  });
});
