import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  compareKeys,
  parseLeader,
  parseVim,
  whichKeyKey,
} from "../tools/core/keys.mts";

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
const printable = (except: string) =>
  fc
    .integer({ min: 0x21, max: 0x7e })
    .map((code) => String.fromCharCode(code))
    .filter((char) => !except.includes(char));
// A Vim key is one or more tokens: a printable ASCII character other than space, "<" and "|", or a
// <...> group with no space, "<", ">" or "|" inside.
const vimGroup = fc.oneof(
  fc.constantFrom(
    "<C-w>",
    "<Space>",
    "<CR>",
    "<Esc>",
    "<lt>",
    "<Bar>",
    "<C-]>",
    "<C-\\>",
    "<F12>",
  ),
  fc
    .array(printable("<>|"), { minLength: 1, maxLength: 6 })
    .map((chars) => `<${chars.join("")}>`),
);
const vimKey = fc.array(fc.oneof(printable("<|"), vimGroup), {
  minLength: 1,
  maxLength: 5,
});

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

describe("parseVim", () => {
  test("splits a Vim key into its tokens", () => {
    expect(parseVim("gra")).toEqual({ ok: true, tokens: ["g", "r", "a"] });
    expect(parseVim("]d")).toEqual({ ok: true, tokens: ["]", "d"] });
    expect(parseVim("K")).toEqual({ ok: true, tokens: ["K"] });
    expect(parseVim("<C-w>h")).toEqual({ ok: true, tokens: ["<C-w>", "h"] });
    expect(parseVim("<lt><lt>>")).toEqual({
      ok: true,
      tokens: ["<lt>", "<lt>", ">"],
    });
    fc.assert(
      fc.property(vimKey, (tokens) => {
        expect(parseVim(tokens.join(""))).toEqual({ ok: true, tokens });
      }),
    );
  });

  test("reports a malformed Vim key instead of splitting it", () => {
    expect(parseVim("g a")).toEqual({
      ok: false,
      message:
        '"g a" is not a Vim key: keys without spaces, each a printable ASCII character other than < and |, or a <...> group such as <C-w>',
    });
    const malformed = [
      "",
      "g a",
      "a|b",
      "<",
      "<C-w",
      "<>",
      "<C w>",
      "<C-|>",
      "x<y",
      "<<",
      "<a<b>",
      "é",
      "a\tb",
      "a\n",
      "a\x7f",
      "\0",
    ];
    const accepted = malformed.filter((text) => {
      const parsed = parseVim(text);
      return (
        parsed.ok ||
        !parsed.message.startsWith(`${JSON.stringify(text)} is not a Vim key: `)
      );
    });
    expect(accepted).toEqual([]);
    // A space or a "|" anywhere, even inside a group, makes it malformed.
    fc.assert(
      fc.property(
        vimKey,
        fc.constantFrom(" ", "|"),
        fc.nat(),
        (tokens, char, n) => {
          const text = tokens.join("");
          const at = n % (text.length + 1);
          expect(
            parseVim(`${text.slice(0, at)}${char}${text.slice(at)}`).ok,
          ).toBe(false);
        },
      ),
    );
  });
});

describe("compareKeys", () => {
  // Small alphabets make shared prefixes and equal keys likely.
  const key = fc.oneof(
    leaderKey,
    vimKey,
    fc.array(fc.constantFrom("SPC", "a", "b", "/", "<C-w>"), {
      minLength: 1,
      maxLength: 3,
    }),
  );
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((token, i) => token === b[i]);

  test("is a total order consistent with token equality", () => {
    fc.assert(
      fc.property(key, key, (a, b) => {
        expect(compareKeys(a, [...a])).toBe(0);
        expect(compareKeys(a, b) === 0).toBe(same(a, b));
        expect(
          Math.sign(compareKeys(a, b)) + Math.sign(compareKeys(b, a)),
        ).toBe(0);
      }),
    );
    fc.assert(
      fc.property(key, key, key, (a, b, c) => {
        if (compareKeys(a, b) <= 0 && compareKeys(b, c) <= 0) {
          expect(compareKeys(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  test("sorts SPC as a space, before every other key, and the rest by code unit", () => {
    const leader = [
      ["SPC", "w"],
      ["SPC", "b", "d"],
      ["SPC", "/"],
      ["SPC", "SPC"],
      ["SPC", "B"],
      ["SPC", "b"],
    ];
    expect([...leader].sort(compareKeys)).toEqual([
      ["SPC", "SPC"],
      ["SPC", "/"],
      ["SPC", "B"],
      ["SPC", "b"],
      ["SPC", "b", "d"],
      ["SPC", "w"],
    ]);
    const vim = [
      ["g", "r", "a"],
      ["]", "d"],
      ["K"],
      ["<C-w>", "h"],
      ["[", "d"],
    ];
    expect([...vim].sort(compareKeys)).toEqual([
      ["<C-w>", "h"],
      ["K"],
      ["[", "d"],
      ["]", "d"],
      ["g", "r", "a"],
    ]);
    fc.assert(
      fc.property(fc.oneof(leaderToken, printable("<|"), vimGroup), (token) => {
        if (token !== "SPC")
          expect(compareKeys(["SPC"], [token])).toBeLessThan(0);
      }),
    );
  });
});

describe("whichKeyKey", () => {
  test("renders SPC as a space and every other leader token as itself", () => {
    expect(["SPC", "w", "/", "W", "0", "?"].map(whichKeyKey)).toEqual([
      " ",
      "w",
      "/",
      "W",
      "0",
      "?",
    ]);
    // which-key matches one typed character per menu level.
    fc.assert(
      fc.property(leaderToken, (token) => {
        expect(whichKeyKey(token)).toHaveLength(1);
      }),
    );
  });
});
