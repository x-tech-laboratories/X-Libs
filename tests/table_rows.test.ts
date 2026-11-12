import { describe, expect, it } from "vitest";

import { cell_text, filter_rows, keyed_rows, next_sort_keys, sort_rows, tree_rows, type SortColumn } from "../src/web/tables.ts";

const COLUMNS: SortColumn[] = [
  { name: "host", field: "host" },
  { name: "status", field: "status" },
  { name: "size", field: "size", sort_field: "size_bytes" },
  { name: "actions", field: "actions" },
];

const ROWS = [
  { host: "host10", status: "online", size: "2 KB", size_bytes: 2048 },
  { host: "host9", status: "failed", size: "900 B", size_bytes: 900 },
  { host: "host2", status: "online", size: "", size_bytes: null },
];

const hosts = (rows: { host: unknown }[]) => rows.map((row) => row.host);

// ── Row ordering ─────────────────────────────────────────────────────────────

describe("sorting rows", () => {
  it("uses the first key then the next", () => {
    expect(hosts(sort_rows(ROWS, [["status", false], ["host", true]], COLUMNS))).toEqual(["host9", "host10", "host2"]);
  });

  it("orders numbers inside text naturally", () => {
    expect(hosts(sort_rows(ROWS, [["host", false]], COLUMNS))).toEqual(["host2", "host9", "host10"]);
  });

  it("uses the raw sort field and keeps empty cells last both ways", () => {
    expect(hosts(sort_rows(ROWS, [["size", false]], COLUMNS))).toEqual(["host9", "host10", "host2"]);
    expect(hosts(sort_rows(ROWS, [["size", true]], COLUMNS))).toEqual(["host10", "host9", "host2"]);
  });

  it("copes with numbers and text in one column", () => {
    const rows = [{ v: "abc" }, { v: 3 }, { v: null }, { v: 1.5 }];
    expect(sort_rows(rows, [["v", false]], [{ name: "v", field: "v" }]).map((row) => row.v)).toEqual([1.5, 3, "abc", null]);
  });

  it("filters on every word somewhere in the fields", () => {
    expect(hosts(filter_rows(ROWS, "ONLINE host1", ["host", "status"]))).toEqual(["host10"]);
    expect(filter_rows(ROWS, "  ", ["host"])).toEqual(ROWS);
  });
});

// ── Header clicks ────────────────────────────────────────────────────────────

describe("header clicks", () => {
  it("step one column from ascending to descending to off", () => {
    let keys = next_sort_keys([], "host", false);
    expect(keys).toEqual([["host", false]]);
    keys = next_sort_keys(keys, "host", false);
    expect(keys).toEqual([["host", true]]);
    expect(next_sort_keys(keys, "host", false)).toEqual([]);
  });

  it("replace a multi-column sort on a plain click on another column", () => {
    expect(next_sort_keys([["host", false], ["status", true]], "size", false)).toEqual([["size", false]]);
  });

  it("add, flip and drop a column on shift-clicks and keep the rest", () => {
    let keys = next_sort_keys([["host", false]], "status", true);
    expect(keys).toEqual([["host", false], ["status", false]]);
    keys = next_sort_keys(keys, "status", true);
    expect(keys).toEqual([["host", false], ["status", true]]);
    expect(next_sort_keys(keys, "status", true)).toEqual([["host", false]]);
  });
});

// ── Trees ────────────────────────────────────────────────────────────────────

const TREE_COLUMNS: SortColumn[] = [{ name: "name", field: "name" }, { name: "cpu", field: "cpu" }];

const TREE_ROWS = [
  { id: 1, parent: null, name: "init", cpu: 9 },
  { id: 2, parent: 1, name: "shell", cpu: 1 },
  { id: 3, parent: 1, name: "browser", cpu: 8 },
  { id: 4, parent: 3, name: "tab", cpu: 7 },
  { id: 5, parent: 99, name: "orphan", cpu: 0 },
];

function tree(sort_keys: [string, boolean][] = [], collapsed: number[] = [], term = "") {
  return tree_rows(TREE_ROWS, "id", "parent", sort_keys, TREE_COLUMNS, new Set(collapsed), term, ["name"]).map((row) => [row.name, row._depth]);
}

describe("tree rows", () => {
  it("nest each row under its parent and make a root of one whose parent is missing", () => {
    expect(tree()).toEqual([["init", 0], ["shell", 1], ["browser", 1], ["tab", 2], ["orphan", 0]]);
  });

  it("sort siblings within their parent", () => {
    expect(tree([["cpu", true]])).toEqual([["init", 0], ["browser", 1], ["tab", 2], ["shell", 1], ["orphan", 0]]);
  });

  it("leave out what sits under a collapsed row", () => {
    const rows = tree_rows(TREE_ROWS, "id", "parent", [], TREE_COLUMNS, new Set([3]), "", ["name"]);
    expect(rows.map((row) => row.name)).toEqual(["init", "shell", "browser", "orphan"]);
    expect([rows[2]!._has_children, rows[2]!._expanded]).toEqual([true, false]);
    expect(rows[1]!._has_children).toBe(false);
  });

  it("keep each match with its ancestors under a filter even when collapsed", () => {
    expect(tree([], [1, 3], "tab")).toEqual([["init", 0], ["browser", 1], ["tab", 2]]);
  });

  it("copy the rows they mark", () => {
    tree_rows(TREE_ROWS, "id", "parent", [], TREE_COLUMNS, new Set());
    expect(TREE_ROWS[0]).not.toHaveProperty("_depth");
  });
});

// ── Row keys ─────────────────────────────────────────────────────────────────

const FEED = [
  { timestamp: "10:00:02", message: "disk full" },
  { timestamp: "10:00:01", message: "started" },
  { timestamp: "10:00:01", message: "started" },
];

describe("keyed rows", () => {
  it("give every row without a key its own", () => {
    expect(new Set(keyed_rows(FEED, "id").map((row) => row.id)).size).toBe(3);
  });

  it("keep a row's key when newer rows push in above it", () => {
    const before = keyed_rows(FEED, "id");
    const after = keyed_rows([{ timestamp: "10:00:03", message: "cleared" }, ...FEED.slice(0, 2)], "id");
    expect(after.slice(1).map((row) => row.id)).toEqual(before.slice(0, 2).map((row) => row.id));
  });

  it("leave a row's own key alone", () => {
    expect(keyed_rows([{ id: 7, name: "cpu" }], "id")).toEqual([{ id: 7, name: "cpu" }]);
  });

  it("copy the rows they key", () => {
    keyed_rows(FEED, "id");
    expect(FEED[0]).not.toHaveProperty("id");
  });
});

describe("cell text", () => {
  it("reads cells as Python's str writes them, an absent one as empty", () => {
    expect([cell_text(undefined), cell_text(null), cell_text(true), cell_text([1]), cell_text(2.5)]).toEqual(["", "None", "True", "[1]", "2.5"]);
    expect(filter_rows([{ ok: true }, { ok: false }], "true", ["ok"])).toEqual([{ ok: true }]);
  });
});
