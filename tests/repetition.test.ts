import { describe, expect, it } from "vitest";

import { is_repeating, repeat_check_chars, repeat_window_chars, repetition_watch } from "../src/repetition.ts";

const loop = "'Twenty-one' rhymes with 'twenty-one'. ";

describe("repetition", () => {
  it("tells repetition from prose", () => {
    expect(is_repeating(loop.repeat(40))).toBe(true);
    expect(is_repeating("short")).toBe(false);
    const prose = Array.from({ length: repeat_window_chars / 10 }, (_, index) => `w${index * 7919}x `).join("");
    expect(is_repeating(prose)).toBe(false);
  });

  it("checks streaming text only once enough has arrived since the last check", () => {
    const watch = repetition_watch();
    const text = loop.repeat(40);
    expect(watch(text.slice(0, repeat_check_chars - 1))).toBe(false);
    expect(watch(text)).toBe(true);
    expect(watch(`${text}x`)).toBe(false);
    expect(watch(text + loop.repeat(10))).toBe(true);
  });
});
