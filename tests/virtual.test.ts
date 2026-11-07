import { describe, expect, it } from "vitest";

import { virtual_window } from "../src/web/virtual.ts";

describe("virtual_window", () => {
  it("draws the rows in view and a few either side", () => {
    expect(virtual_window(1000, 20, 2000, 400, 5)).toEqual({ start: 95, end: 125, offset_px: 1900, total_px: 20000 });
  });

  it("stays inside the list at the top and bottom", () => {
    expect(virtual_window(50, 20, -30, 400).start).toBe(0);
    expect(virtual_window(50, 20, 990, 400).end).toBe(50);
    expect(virtual_window(0, 20, 0, 400)).toEqual({ start: 0, end: 0, offset_px: 0, total_px: 0 });
  });

  it("refuses a row with no height", () => {
    expect(() => virtual_window(10, 0, 0, 100)).toThrow();
  });
});
