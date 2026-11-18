import { describe, expect, it } from "vitest";

import {
  and,
  define_catalogue,
  evaluate,
  find_cycle,
  FilterStack,
  is_group,
  leaf,
  not,
  or,
  rank_records,
  ranked_sets,
  referenced_fields,
  select_ids,
  shuffle_position,
  sort_records,
  type FilterNode,
  type FilterRecord,
} from "../src/filter.ts";

const catalogue = define_catalogue({
  table: "tasks",
  fields: {
    title: { kind: "column", column: "title" },
    points: { kind: "column", column: "points" },
    due: { kind: "column", column: "due", clock: "seconds" },
    label: { kind: "set", table: "task_labels", row_column: "task_id", value_column: "label" },
    attachment: { kind: "related", table: "attachments", foreign_key: "task_id", column: "kind" },
  },
  operators: {
    starred: { sql: (_node, context) => `${context.row}.starred = 1`, evaluate: (record) => record.values.starred === 1 },
    searched: { sql: (node, context) => `${context.row_id} IN (SELECT rowid FROM search WHERE search MATCH ${context.param(node.value)})` },
  },
});

const now = 1_750_000_000_000;
const tasks: FilterRecord[] = [
  { id: "a", values: { title: "Write report", points: 3, due: now / 1000 - 3600, label: ["work"], attachment: ["pdf", null], starred: 1 } },
  { id: "b", values: { title: "write LETTER", points: 1, due: null, label: ["home", "work"], attachment: [] } },
  { id: "c", values: { title: null, points: null, due: now / 1000 - 30 * 86_400, label: [], attachment: ["image"] } },
  { id: "d", values: { title: "Été", points: 3, label: ["home"], attachment: ["pdf"] } },
];

const matching = (node: FilterNode): string[] => select_ids(catalogue, node, tasks, { now }).map(String);

describe("filter tree", () => {
  it("builds groups and leaves and lists the fields it names", () => {
    const node = and(leaf("title", "contains", "x"), or(leaf("points", ">", 1), not(leaf("label", "any", ["home"]))));

    expect(is_group(node)).toBe(true);
    expect(leaf("points", "empty")).toEqual({ field: "points", op: "empty" });
    expect([...referenced_fields(node)].sort()).toEqual(["label", "points", "title"]);
  });

  it("finds a saved filter that would contain itself", () => {
    const saved: Record<string, FilterNode> = { b: leaf("", "in_filter", "c"), c: leaf("", "in_filter", "a"), d: leaf("points", ">", 1) };
    const resolve = (id: string): FilterNode | undefined => saved[id];

    expect(find_cycle("a", and(leaf("", "in_filter", "b")), resolve)).toEqual(["b", "c", "a"]);
    expect(find_cycle("a", leaf("", "in_filter", "d"), resolve)).toBeNull();
    expect(find_cycle("a", leaf("", "in_filter", "a"), resolve)).toEqual(["a"]);
  });
});

describe("evaluating in memory", () => {
  it("folds ASCII case only, as SQLite's LIKE does", () => {
    expect(matching(leaf("title", "starts", "write"))).toEqual(["a", "b"]);
    expect(matching({ field: "title", op: "starts", value: "write", case_sensitive: true })).toEqual(["b"]);
    expect(matching(leaf("title", "is", "été"))).toEqual([]);
  });

  it("never matches a missing value, so a negation does", () => {
    expect(matching(leaf("points", "<", 5))).toEqual(["a", "b", "d"]);
    expect(matching(not(leaf("points", "<", 5)))).toEqual(["c"]);
    expect(matching(leaf("points", "not_is", 3))).toEqual(["b", "c"]);
  });

  it("matches sets by their values and related fields by any related row", () => {
    expect(matching(leaf("label", "all", ["home", "work"]))).toEqual(["b"]);
    expect(matching(leaf("label", "none", ["work"]))).toEqual(["c", "d"]);
    expect(matching(leaf("label", "count", 0))).toEqual(["c"]);
    expect(matching(leaf("attachment", "is", "pdf"))).toEqual(["a", "d"]);
    expect(matching(leaf("attachment", "empty"))).toEqual(["a"]);
  });

  it("counts back from now in the field's own unit", () => {
    expect(matching(leaf("due", "in_last", { count: 1, unit: "week" }))).toEqual(["a"]);
    expect(matching(leaf("due", "not_in_last", { count: 1, unit: "week" }))).toEqual(["b", "c", "d"]);
  });

  it("ranks the top and bottom by value, ties by id", () => {
    expect(rank_records(tasks, "points", 1)).toEqual({ top: new Set(["a"]), bottom: new Set(["b"]) });
    expect(matching(leaf("points", "top", 2))).toEqual(["a", "d"]);
    expect(ranked_sets(leaf("points", "bottom", 1), tasks).get("points:bottom:1")).toEqual(new Set(["b"]));
  });

  it("runs the app's operators, and refuses one that has only SQL", () => {
    expect(matching(leaf("", "starred"))).toEqual(["a"]);
    expect(() => matching(leaf("", "searched", "x"))).toThrow(/only in SQL/);
  });

  it("takes true and false as 1 and 0", () => {
    expect(evaluate(catalogue, leaf("points", "is", true), tasks[1]!, { now })).toBe(true);
  });

  it("puts a saved filter in place", () => {
    const resolve = (id: string): FilterNode | undefined => (id === "big" ? leaf("points", ">=", 3) : undefined);

    expect(select_ids(catalogue, leaf("", "in_filter", "big"), tasks, { now, resolve })).toEqual(["a", "d"]);
    expect(() => select_ids(catalogue, leaf("", "in_filter", "gone"), tasks, { now, resolve })).toThrow(/no saved filter/);
  });

  it("refuses fields it does not know and operators that do not fit", () => {
    expect(() => matching(leaf("colour", "is", "red"))).toThrow(/unknown field: colour/);
    expect(() => matching(leaf("label", "contains", "x"))).toThrow(/not valid on set field label/);
    expect(() => matching(leaf("attachment", "top", 1))).toThrow(/not valid on field attachment/);
  });
});

describe("sorting in memory", () => {
  it("sorts missing values last either way, ties by id", () => {
    expect(select_ids(catalogue, and(), tasks, { now, sort: [{ field: "points" }] })).toEqual(["b", "a", "d", "c"]);
    expect(select_ids(catalogue, and(), tasks, { now, sort: [{ field: "points", descending: true }] })).toEqual(["a", "d", "b", "c"]);
    expect(sort_records(catalogue, tasks, [{ field: "label" }]).map((task) => task.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("shuffles the same way each time for a seed", () => {
    const shuffled = (seed: number): string[] => sort_records(catalogue, tasks, [{ field: "random", seed }]).map((task) => String(task.id));

    expect(shuffled(7)).toEqual(shuffled(7));
    expect(shuffled(7).sort()).toEqual(["a", "b", "c", "d"]);
    expect(shuffle_position(7, "a")).toBe(shuffle_position(7 + 2_147_483_647, "a"));
    expect(shuffle_position(7, "a")).not.toBe(shuffle_position(8, "a"));
    expect(() => shuffle_position(0.5, "a")).toThrow(/whole number/);
  });
});

describe("filter stack", () => {
  it("joins its chips into one filter", () => {
    const stack = new FilterStack();
    stack.push({ id: "label", label: "Work", node: leaf("label", "any", ["work"]), removable: true });
    stack.push({ id: "points", label: "3+", node: leaf("points", ">=", 3), removable: true });

    const filter = stack.to_filter();

    expect(is_group(filter) && filter.op === "and" && filter.children.length).toBe(2);
    expect(stack.version).toBe(2);
  });

  it("replaces a chip of the same id rather than adding a second", () => {
    const stack = new FilterStack();
    stack.push({ id: "label", label: "Work", node: leaf("label", "any", ["work"]), removable: true });
    stack.push({ id: "label", label: "Home", node: leaf("label", "any", ["home"]), removable: true });

    expect(stack.list().map((chip) => chip.label)).toEqual(["Home"]);
    expect(stack.to_filter()).toEqual(leaf("label", "any", ["home"]));
  });

  it("keeps the chips that cannot be removed when cleared, and matches everything when empty", () => {
    const stack = new FilterStack();
    stack.push({ id: "all", label: "Everything", node: and(), removable: false });
    stack.push({ id: "label", label: "Work", node: leaf("label", "any", ["work"]), removable: true });

    stack.clear();
    stack.remove("missing");

    expect(stack.list().map((chip) => chip.id)).toEqual(["all"]);
    expect(stack.to_filter()).toEqual(and());
  });
});
