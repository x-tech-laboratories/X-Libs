import { describe, expect, test } from "vitest";

import {
  by_position, can_drop, children_of, move_for_drop, move_for_key, moves_for_drop, nest, placement_at, position_for_drop, subtree_ids, type TreeItem,
} from "../src/web/tree.ts";

// root a (1) holds b (1) and c (2); c holds d (1); root e (2)
const items: TreeItem[] = [
  { id: "a", parent_id: null, position: 1 },
  { id: "b", parent_id: "a", position: 1 },
  { id: "c", parent_id: "a", position: 2 },
  { id: "d", parent_id: "c", position: 1 },
  { id: "e", parent_id: null, position: 2 },
];
const item = (id: string) => items.find((each) => each.id === id)!;

// ── Shape ────────────────────────────────────────────────────────────────────

describe("tree shape", () => {
  test("finds children and whole subtrees", () => {
    expect(children_of("a", items).map((each) => each.id)).toEqual(["b", "c"]);
    expect([...subtree_ids("a", items)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("sorts by position", () => {
    expect([item("e"), item("a")].sort(by_position).map((each) => each.id)).toEqual(["a", "e"]);
  });

  test("nests shown rows under their nearest shown ancestor", () => {
    const shown = items.filter((each) => each.id !== "c");

    const roots = nest(shown, items);

    expect(roots.map((node) => node.item.id)).toEqual(["a", "e"]);
    expect(roots[0]!.children.map((node) => node.item.id)).toEqual(["b", "d"]);
  });

  test("puts a row whose parent is missing at the top", () => {
    expect(nest([{ id: "x", parent_id: "gone", position: 1 }]).map((node) => node.item.id)).toEqual(["x"]);
  });
});

// ── Dropping ─────────────────────────────────────────────────────────────────

describe("dropping", () => {
  test("splits a row into before, inside and after", () => {
    expect(placement_at(0.1, true)).toBe("before");
    expect(placement_at(0.5, true)).toBe("inside");
    expect(placement_at(0.9, true)).toBe("after");
    expect(placement_at(0.4, false)).toBe("before");
    expect(placement_at(0.6, false)).toBe("after");
  });

  test("refuses a drop into the dragged row's own subtree", () => {
    expect(can_drop("a", "d", items)).toBe(false);
    expect(can_drop("d", "a", items)).toBe(true);
  });

  test("drops between two siblings at the midpoint", () => {
    expect(move_for_drop(item("e"), item("c"), "before", items)).toEqual({ parent_id: "a", position: 1.5 });
  });

  test("drops past the last sibling one step further", () => {
    expect(move_for_drop(item("e"), item("c"), "after", items)).toEqual({ parent_id: "a", position: 3 });
  });

  test("drops inside after the last child", () => {
    expect(move_for_drop(item("e"), item("a"), "inside", items)).toEqual({ parent_id: "a", position: 3 });
  });

  test("keeps a flat list's order around the dragged item", () => {
    expect(position_for_drop(item("a"), item("e"), "after", [item("a"), item("e")])).toBe(3);
  });

  test("moves several rows in a run between the target and its neighbour", () => {
    expect(moves_for_drop([item("d"), item("e")], item("b"), "after", items)).toEqual([
      { parent_id: "a", position: 1 + 1 / 3 },
      { parent_id: "a", position: 1 + 2 / 3 },
    ]);
  });
});

// ── Keyboard moves ───────────────────────────────────────────────────────────

describe("keyboard moves", () => {
  test("moves up and down past a sibling", () => {
    expect(move_for_key(item("c"), "up", items)).toEqual({ parent_id: "a", position: 0 });
    expect(move_for_key(item("b"), "down", items)).toEqual({ parent_id: "a", position: 3 });
    expect(move_for_key(item("b"), "up", items)).toBeNull();
  });

  test("indents into the sibling above and outdents after the parent", () => {
    expect(move_for_key(item("c"), "indent", items)).toEqual({ parent_id: "b", position: 2 });
    expect(move_for_key(item("d"), "outdent", items)).toEqual({ parent_id: "a", position: 3 });
    expect(move_for_key(item("a"), "outdent", items)).toBeNull();
  });
});
