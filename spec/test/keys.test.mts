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

  test("reports a malformed leader key instead of splitting it", () => {
    expect(parseLeader("SPC wh")).toEqual({
      ok: false,
      message:
        '"SPC wh" is not a leader key: "SPC" and then keys separated by single spaces, each SPC or one of a-z A-Z 0-9 / ? : =',
    });
    const malformed = [
      "",
      "SPC",
      "spc w",
      "w h",
      "SPCw",
      "SPC  w",
      " SPC w",
      "SPC w ",
      "SPC ,",
      "SPC\tw",
      "SPC w\n",
      "SPC <C-w>",
      "SPC é",
      "SPC SPCSPC",
    ];
    const accepted = malformed.filter((text) => {
      const parsed = parseLeader(text);
      return (
        parsed.ok ||
        !parsed.message.startsWith(
          `${JSON.stringify(text)} is not a leader key: `,
        )
      );
    });
    expect(accepted).toEqual([]);
    // A stray space anywhere breaks the single-space rule.
    fc.assert(
      fc.property(leaderKey, fc.nat(), (tokens, n) => {
        const text = tokens.join(" ");
        const at = n % (text.length + 1);
        expect(parseLeader(`${text.slice(0, at)} ${text.slice(at)}`).ok).toBe(
          false,
        );
      }),
    );
  });
});
