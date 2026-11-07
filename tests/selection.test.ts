import { describe, expect, it } from "vitest";

import { Selection, intent_for, row_after_key, still_shown, toggled, with_range } from "../src/web/selection.ts";

const rows = [10, 20, 30, 40, 50, 60];

// ============================================================================
// Clicks
// ============================================================================

describe("selection", () => {
  it("picks one row on a plain click and replaces it on the next", () => {
    const selection = new Selection();
    selection.apply(rows, 2, "replace");
    selection.apply(rows, 4, "replace");
    expect(selection.ids()).toEqual([50]);
    expect(selection.has(50)).toBe(true);
    expect(selection.size).toBe(1);
  });

  it("toggles a row with Ctrl and keeps the others", () => {
    const selection = new Selection();
    selection.apply(rows, 1, "replace");
    selection.apply(rows, 3, "toggle");
    selection.apply(rows, 1, "toggle");
    expect(selection.ids()).toEqual([40]);
  });

  it("ranges from a fixed anchor, so a range can shrink again", () => {
    const selection = new Selection();
    selection.apply(rows, 2, "replace");
    selection.apply(rows, 5, "range");
    expect(selection.ids()).toEqual([30, 40, 50, 60]);
    selection.apply(rows, 3, "range");
    expect(selection.ids()).toEqual([30, 40]);
    selection.apply(rows, 0, "range");
    expect(selection.ids().sort()).toEqual([10, 20, 30]);
    expect(selection.inspect()).toEqual({ size: 3, anchor: 2 });
  });

  it("adds a range to what is picked with Ctrl+Shift", () => {
    const selection = new Selection();
    selection.apply(rows, 0, "replace");
    selection.apply(rows, 4, "toggle");
    selection.apply(rows, 5, "range-add");
    expect(selection.ids().sort()).toEqual([10, 50, 60]);
  });

  it("selects all, inverts, keeps only rows still shown, and clears", () => {
    const selection = new Selection();
    selection.apply(rows, 0, "replace");
    selection.invert(rows);
    expect(selection.ids()).toEqual([20, 30, 40, 50, 60]);
    selection.retain([20, 30]);
    expect(selection.ids()).toEqual([20, 30]);
    selection.select_all(rows);
    expect(selection.size).toBe(6);
    selection.clear();
    expect(selection.inspect()).toEqual({ size: 0, anchor: null });
  });

  it("ignores a click outside the list", () => {
    const selection = new Selection();
    selection.apply(rows, 9, "replace");
    expect(selection.size).toBe(0);
  });

  it("works on any kind of id", () => {
    const selection = new Selection<string>();
    selection.apply(["a", "b", "c"], 1, "replace");
    selection.apply(["a", "b", "c"], 2, "range");
    expect(selection.ids()).toEqual(["b", "c"]);
  });
});

// ============================================================================
// Modifiers and keys
// ============================================================================

describe("intents and keys", () => {
  it("reads the intent from the modifiers", () => {
    expect(intent_for({})).toBe("replace");
    expect(intent_for({ ctrl: true })).toBe("toggle");
    expect(intent_for({ shift: true })).toBe("range");
    expect(intent_for({ shift: true, ctrl: true })).toBe("range-add");
  });

  it("moves by row, by page and to either end, held inside the list", () => {
    expect(row_after_key("ArrowDown", 2, 5, 3)).toBe(3);
    expect(row_after_key("ArrowDown", 5, 5, 3)).toBe(5);
    expect(row_after_key("ArrowUp", 0, 5, 3)).toBe(0);
    expect(row_after_key("PageDown", 4, 5, 3)).toBe(5);
    expect(row_after_key("PageUp", 4, 5, 3)).toBe(1);
    expect(row_after_key("Home", 4, 5, 3)).toBe(0);
    expect(row_after_key("End", 1, 5, 3)).toBe(5);
    expect(row_after_key("a", 1, 5, 3)).toBeNull();
  });
});

describe("picking by id", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("toggles one id in and out", () => {
    expect(toggled(["a"], "c")).toEqual(["a", "c"]);
    expect(toggled(["a", "c"], "a")).toEqual(["c"]);
  });

  it("adds the run between the anchor and the id, either way round", () => {
    expect(with_range(order, ["a"], "b", "d")).toEqual(["a", "b", "c", "d"]);
    expect(with_range(order, ["e"], "d", "b")).toEqual(["e", "b", "c", "d"]);
    expect(with_range(order, ["c"], "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("picks just the id when the anchor is missing or not shown", () => {
    expect(with_range(order, ["a"], null, "c")).toEqual(["c"]);
    expect(with_range(order, ["a"], "gone", "c")).toEqual(["c"]);
  });

  it("keeps only the picked ids still shown, in the shown order", () => {
    expect(still_shown(order, ["d", "gone", "a"])).toEqual(["a", "d"]);
  });
});
