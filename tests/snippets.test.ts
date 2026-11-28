import { describe, expect, it } from "vitest";

import { shorten } from "../src/snippets.ts";

describe("shorten", () => {
  it("puts the text on one line", () => {
    expect(shorten("  one\n\ntwo\tthree  ")).toBe("one two three");
  });

  it("keeps text that fits and cuts longer text with an ellipsis", () => {
    expect(shorten("x".repeat(200))).toBe("x".repeat(200));
    expect(shorten("x".repeat(201))).toBe(`${"x".repeat(199)}…`);
    expect(shorten("abcdef", 4)).toBe("abc…");
  });
});
