import { describe, expect, test } from "vitest";
import { suggest } from "../tools/core/ids.mts";

describe("suggest", () => {
  test("returns the three known IDs nearest by edit distance, ties in code-unit order", () => {
    // Distances from "abcz": abc 1, abcd 1, ab 2, abd 2, xbc 2, zzzz 3.
    const known = ["zzzz", "xbc", "abd", "abcd", "abc", "ab"];
    expect([
      suggest("abcz", known),
      suggest("x", ["b", "a"]),
      suggest("x", []),
    ]).toEqual([["abc", "abcd", "ab"], ["a", "b"], []]);
  });
});
