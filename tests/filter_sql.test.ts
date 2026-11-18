import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, define_catalogue, leaf, not, or, type FilterNode } from "../src/filter.ts";
import { compile_filter, compile_group_by, query_rows, quote_name, regexp_matches, type GroupRow } from "../src/filter_sql.ts";
import { catalogue, FIXED_NOW, open_corpus, type Corpus } from "./filter_corpus.ts";

describe("filter_sql", () => {
  let corpus: Corpus;

  beforeAll(() => {
    corpus = open_corpus(300, 7);
  });

  afterAll(() => corpus.database.close());

  const ids = (node: FilterNode): string[] => query_rows<{ id: string }>(corpus.database, compile_filter(catalogue, node, { now: FIXED_NOW })).map((row) => row.id);

  it("passes every value as a parameter, never in the SQL", () => {
    const hostile = "'; DROP TABLE items; --";

    const { sql, params } = compile_filter(catalogue, or(leaf("title", "contains", hostile), leaf("genre", "any", [hostile]), leaf("year", "is", 1)));

    expect(sql).not.toContain("DROP TABLE");
    expect(params).toEqual(["%'; DROP TABLE items; --%", 1, hostile, 1, 1]);
  });

  it("reads table and column names from the Drizzle schema or as text", () => {
    const { sql } = compile_filter(catalogue, and(leaf("title", "is", "x"), leaf("rating", "is", 1), leaf("format", "is", "flac")));

    expect(sql).toContain('FROM "items" t WHERE');
    expect(sql).toContain('t."title" = ?');
    expect(sql).toContain('t."rating" = ?');
    expect(sql).toContain('FROM "files" related WHERE related."item_id" = t."id"');
  });

  it("takes an empty and as everything and an empty or as nothing", () => {
    expect(ids(and())).toHaveLength(300);
    expect(ids(or())).toHaveLength(0);
  });

  it("keeps a missing value apart from zero", () => {
    const unrated = ids(leaf("rating", "empty"));
    const zero = ids(leaf("rating", "is", 0));

    expect(unrated.length).toBeGreaterThan(0);
    expect(zero.length).toBeGreaterThan(0);
    expect(unrated.filter((id) => zero.includes(id))).toEqual([]);
  });

  it("counts a row with a missing value as not matching, so its negation matches it", () => {
    const rated = ids(leaf("rating", ">=", 0));
    const negated = ids(not(leaf("rating", ">=", 0)));

    expect(rated.length + negated.length).toBe(300);
    expect(negated).toEqual(ids(leaf("rating", "empty")));
  });

  it("matches a set by any, all or none of its values", () => {
    const any_of = ids(leaf("genre", "any", ["Jazz", "Blues"]));
    const all_of = ids(leaf("genre", "all", ["Jazz", "Blues"]));
    const none_of = ids(leaf("genre", "none", ["Jazz", "Blues"]));

    expect(all_of.every((id) => any_of.includes(id))).toBe(true);
    expect(any_of.filter((id) => none_of.includes(id))).toEqual([]);
    expect(any_of.length + none_of.length).toBe(300);
  });

  it("matches a related field when any related row does", () => {
    const flac = ids(leaf("format", "is", "flac"));
    const not_flac = ids(not(leaf("format", "is", "flac")));

    expect(flac.length).toBeGreaterThan(0);
    expect(flac.length + not_flac.length).toBe(300);
  });

  it("folds ASCII case unless asked not to, as SQLite does", () => {
    const folded = ids(leaf("format", "is", "mp3"));
    const contains = ids(leaf("format", "contains", "mp"));
    const exact = ids({ field: "format", op: "contains", value: "mp", case_sensitive: true });

    expect(folded).toEqual([]);
    expect(contains.length).toBeGreaterThan(0);
    expect(exact).toEqual([]);
    expect(ids({ field: "title", op: "contains", value: "50%_", case_sensitive: true })).toEqual(ids(leaf("title", "contains", "50%_")));
  });

  it("matches a regular expression through the REGEXP the app registers", () => {
    expect(ids(leaf("title", "regex", "^Item 1$"))).toHaveLength(ids(leaf("title", "is", "Item 1")).length);
    expect(regexp_matches("(", "text")).toBe(0);
    expect(regexp_matches("x", null)).toBe(0);
  });

  it("counts back from now in the unit each date field is kept in", () => {
    const { params } = compile_filter(catalogue, and(leaf("added", "in_last", { count: 1, unit: "day" }), leaf("last_seen", "in_last", { count: 1, unit: "day" })), { now: FIXED_NOW });

    expect(params).toEqual([FIXED_NOW - 86_400_000, (FIXED_NOW - 86_400_000) / 1000]);
  });

  it("writes an ISO date for a field kept as text", () => {
    const dated = define_catalogue({ table: "items", fields: { when: { kind: "column", column: "when", clock: "iso" } } });

    expect(compile_filter(dated, leaf("when", "in_last", { count: 1, unit: "hour" }), { now: Date.UTC(2026, 0, 1) }).params).toEqual(["2025-12-31T23:00:00.000Z"]);
  });

  it("sorts with missing values last either way and breaks ties by id", () => {
    const query = compile_filter(catalogue, and(), { now: FIXED_NOW, sort: [{ field: "year", descending: true }, { field: "done" }], select: (row) => `${row}.id, ${row}.year, ${row}.done` });
    const rows = query_rows<{ id: string; year: number | null; done: number }>(corpus.database, query);

    const first_missing = rows.findIndex((row) => row.year === null);
    expect(first_missing).toBeGreaterThan(0);
    expect(rows.slice(first_missing).every((row) => row.year === null)).toBe(true);
    const expected = [...rows].sort((left, right) => (left.year === null ? 1 : 0) - (right.year === null ? 1 : 0) || (right.year ?? 0) - (left.year ?? 0) || left.done - right.done || (left.id < right.id ? -1 : 1));
    expect(rows.map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(query.sql).toMatch(/, t\."id"$/);
  });

  it("sorts by a set's first value, a related row's preferred value and a custom order", () => {
    for (const field of ["genre", "tag", "format", "has_files", "shelf"]) {
      expect(() => query_rows(corpus.database, compile_filter(catalogue, and(), { sort: [{ field }] }))).not.toThrow();
    }
    expect(compile_filter(catalogue, and(), { sort: [{ field: "random" }] }).sql).toContain("ORDER BY RANDOM(), t.\"id\"");
  });

  it("pages with a limit and an offset", () => {
    const all = ids(and());
    const page = query_rows<{ id: string }>(corpus.database, compile_filter(catalogue, and(), { sort: [{ field: "title" }], limit: 5, offset: 5 }));
    const sorted = query_rows<{ id: string }>(corpus.database, compile_filter(catalogue, and(), { sort: [{ field: "title" }] }));

    expect(all).toHaveLength(300);
    expect(page.map((row) => row.id)).toEqual(sorted.slice(5, 10).map((row) => row.id));
    expect(query_rows(corpus.database, compile_filter(catalogue, and(), { offset: 295 }))).toHaveLength(5);
  });

  it("groups a set by its values, with counts and sums, sorted by their sort key", () => {
    const rows = query_rows<GroupRow>(corpus.database, compile_group_by(catalogue, leaf("year", ">", 1900), "person", { sums: { total_rating: "rating" } }));

    expect(rows.map((row) => row.label)).toEqual(["Ada", "The Band", "Zoë", "bob"]);
    expect(rows.every((row) => typeof row.group_id === "number" && row.count > 0 && typeof row.total_rating === "number")).toBe(true);
  });

  it("groups a plain set, a column and a related field", () => {
    const tags = query_rows<GroupRow>(corpus.database, compile_group_by(catalogue, and(), "tag"));
    const years = query_rows<GroupRow>(corpus.database, compile_group_by(catalogue, and(), "done"));
    const formats = query_rows<GroupRow>(corpus.database, compile_group_by(catalogue, and(), "format"));

    expect(tags.map((row) => row.label)).toEqual(["essential", "later"]);
    expect(years.map((row) => row.label)).toEqual([0, 1]);
    expect(years.reduce((total, row) => total + row.count, 0)).toBe(300);
    expect(formats.at(-1)!.label).toBeNull();
  });

  it("runs the app's own operators and fields with their values as parameters", () => {
    const { sql, params } = compile_filter(catalogue, and(leaf("", "in_list", "first"), leaf("has_files", "is", false)));

    expect(sql).not.toContain("first");
    expect(params).toEqual(["first", 0]);
    expect(ids(leaf("", "in_list", "first")).length).toBeGreaterThan(0);
  });

  it("puts a saved filter in place and refuses one that contains itself", () => {
    const saved: Record<string, FilterNode> = { recent: leaf("year", ">", 2000), loop: leaf("", "in_filter", "loop") };
    const resolve = (id: string): FilterNode | undefined => saved[id];

    expect(compile_filter(catalogue, leaf("", "in_filter", "recent"), { resolve }).sql).toEqual(compile_filter(catalogue, saved.recent!).sql);
    expect(() => compile_filter(catalogue, leaf("", "in_filter", "loop"), { resolve })).toThrow(/contains itself/);
    expect(() => compile_filter(catalogue, leaf("", "in_filter", "absent"), { resolve })).toThrow(/no saved filter/);
  });

  it("refuses an operator that does not fit the field, and a field the catalogue lacks", () => {
    expect(() => compile_filter(catalogue, leaf("genre", ">", 5))).toThrow(/not valid on set field/);
    expect(() => compile_filter(catalogue, leaf("format", "top", 5))).toThrow(/not valid on field format/);
    expect(() => compile_filter(catalogue, leaf("nonexistent", "is", "x"))).toThrow(/unknown field/);
    expect(() => compile_filter(catalogue, leaf("year", "between", 5))).toThrow(/low and a high/);
  });

  it("quotes names", () => {
    expect(quote_name('odd "name"')).toBe('"odd ""name"""');
  });
});
