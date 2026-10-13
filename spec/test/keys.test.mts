import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { parseLeader } from "../tools/core/keys.mts";

// The key grammar, written out independently of the implementation.
const LEADER_CHARS = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/?:=",
];
const leaderToken = fc.oneof(
  fc.constant("SPC"),
  fc.constantFrom(...LEADER_CHARS),
);
const leaderKey = fc
  .array(leaderToken, { minLength: 1, maxLength: 5 })
  .map((rest) => ["SPC", ...rest]);

describe("parseLeader", () => {
  test("splits a leader key into its tokens", () => {
    expect(parseLeader("SPC w h")).toEqual({
      ok: true,
      tokens: ["SPC", "w", "h"],
    });
    expect(parseLeader("SPC SPC")).toEqual({
      ok: true,
      tokens: ["SPC", "SPC"],
    });
    expect(parseLeader("SPC /")).toEqual({ ok: true, tokens: ["SPC", "/"] });
    fc.assert(
      fc.property(leaderKey, (tokens) => {
        expect(parseLeader(tokens.join(" "))).toEqual({ ok: true, tokens });
      }),
    );
  });
});
