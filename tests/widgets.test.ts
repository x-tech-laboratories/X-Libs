import { describe, expect, it } from "vitest";
import { on_screen_position } from "../src/web/menus.ts";
import { distribute, fit, resize_at } from "../src/web/split.ts";
import { sorted_rows, sorting_from, type Column } from "../src/web/tables.ts";

// ============================================================================
// Splits
// ============================================================================

describe("split sizes", () => {
  it("moves only the two panes beside a handle, stopping at their limits", () => {
    expect(resize_at([200, 300, 100], 0, 50)).toEqual([250, 250, 100]);
    expect(resize_at([200, 300], 0, 500, [{}, { min: 100 }])).toEqual([400, 100]);
    expect(resize_at([200, 300], 0, -500, [{ min: 150 }, {}])).toEqual([150, 350]);
    expect(resize_at([200, 300], 0, 500, [{ max: 260 }, {}])).toEqual([260, 240]);
  });

  it("fits panes to a new length, growing panes first and minimums always kept", () => {
    expect(fit([100, 100], 300, [{}, { grow: true }])).toEqual([100, 200]);
    expect(fit([100, 100], 300)).toEqual([150, 150]);
    expect(fit([100, 100], 100, [{ min: 80 }, { min: 80 }])).toEqual([80, 80]);
  });

  it("starts from each pane's preferred size", () => {
    expect(distribute(600, [{}, { grow: true }], [200])).toEqual([200, 400]);
  });
});

// ============================================================================
// Menus
// ============================================================================

describe("menu placement", () => {
  it("opens at the point when it fits", () => {
    expect(on_screen_position(100, 100, 200, 150, 1000, 800)).toEqual({ left: 100, top: 100 });
  });

  it("flips to the point's other side near an edge", () => {
    expect(on_screen_position(900, 700, 200, 150, 1000, 800)).toEqual({ left: 700, top: 550 });
  });

  it("pushes back from the edge when neither side has room", () => {
    expect(on_screen_position(100, 100, 300, 150, 320, 800)).toEqual({ left: 16, top: 100 });
  });
});

// ============================================================================
// Tables
// ============================================================================

describe("table sorting", () => {
  interface Row {
    name: string;
    size: number | null;
  }
  const columns: Column<Row>[] = [
    { label: "Name", cell: (row) => row.name, sort: (row) => row.name },
    { label: "Size", cell: (row) => row.size, sort: (row) => row.size },
    { label: "Note", cell: () => "" },
  ];
  const rows: Row[] = [{ name: "b", size: 2 }, { name: "a", size: null }, { name: "c", size: 1 }];

  it("sorts by the column named, with missing values last", () => {
    expect(sorted_rows(columns, rows, { key: "Name", descending: false }).map((row) => row.name)).toEqual(["a", "b", "c"]);
    expect(sorted_rows(columns, rows, { key: "Size", descending: false }).map((row) => row.name)).toEqual(["c", "b", "a"]);
    expect(sorted_rows(columns, rows, { key: "Name", descending: true }).map((row) => row.name)).toEqual(["c", "b", "a"]);
  });

  it("keeps the order for a column that does not sort", () => {
    expect(sorted_rows(columns, rows, { key: "Note", descending: false })).toBe(rows);
  });

  it("reads the sorting from a view's query", () => {
    expect(sorting_from(new URLSearchParams("sort=Size&dir=desc"), { key: "Name", descending: false })).toEqual({ key: "Size", descending: true });
    expect(sorting_from(new URLSearchParams(""), { key: "Name", descending: false })).toEqual({ key: "Name", descending: false });
  });
});
