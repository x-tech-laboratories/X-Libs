// For any generated filter over a generated catalogue, the SQL and the check in memory pick the same ids.

import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FilterNode, LeafNode } from "../src/filter.ts";
import { select_ids } from "../src/filter.ts";
import { compile_filter, query_rows } from "../src/filter_sql.ts";
import { catalogue, FIXED_NOW, FORMATS, GENRES, LISTS, open_corpus, PEOPLE, SHELVES, TAGS, type Corpus } from "./filter_corpus.ts";

// ── Filters ──────────────────────────────────────────────────────────────────

const saved: Record<string, FilterNode> = {
  rated: { field: "rating", op: ">=", value: 6 },
  jazz_or_new: { op: "or", children: [{ field: "genre", op: "any", value: ["Jazz"] }, { field: "year", op: ">", value: 2000 }] },
};
const resolve = (id: string): FilterNode | undefined => saved[id];

const words = fc.oneof(fc.constantFrom(...SHELVES, ...FORMATS, "item", "ITEM", "été", "ÉTÉ", "50%", "%_", "_", "note 1", "[", "*", "?", ""), fc.string({ maxLength: 4 }));

const text_leaf = fc
  .record({
    field: fc.constantFrom("title", "shelf", "comment", "format"),
    op: fc.constantFrom("is", "not_is", "contains", "starts", "ends", "empty", "defined"),
    value: words,
    case_sensitive: fc.boolean(),
  })
  .map((leaf) => (leaf.op === "empty" || leaf.op === "defined" ? { field: leaf.field, op: leaf.op } : leaf));

const regex_leaf = fc.record({ field: fc.constantFrom("title", "format"), op: fc.constant("regex"), value: fc.constantFrom("^item", "(?i)x", "[0-9]$", "(", "MP\\d", "é") });

const number_fields = fc.constantFrom("year", "rating", "size", "done");
const number_leaf = fc.oneof(
  fc.record({ field: number_fields, op: fc.constantFrom("is", "not_is", ">", "<", ">=", "<="), value: fc.integer({ min: 0, max: 10_000 }) }),
  fc.record({
    field: number_fields,
    op: fc.constantFrom("between", "not_between"),
    value: fc.tuple(fc.integer({ min: 0, max: 2100 }), fc.integer({ min: 0, max: 10_000 })).map(([low, high]) => [Math.min(low, high), Math.max(low, high)]),
  }),
  fc.record({ field: number_fields, op: fc.constantFrom("empty", "defined") }),
  fc.record({ field: fc.constant("done"), op: fc.constant("is"), value: fc.boolean() }),
);

const set_leaf = fc.oneof(
  fc.record({ field: fc.constantFrom("genre", "person", "tag"), op: fc.constantFrom("any", "all", "none"), value: fc.uniqueArray(fc.constantFrom(...GENRES, ...PEOPLE, ...TAGS, "nothing"), { maxLength: 3 }) }),
  fc.record({ field: fc.constantFrom("genre", "person", "tag"), op: fc.constant("count"), value: fc.integer({ min: 0, max: 3 }) }),
  fc.record({ field: fc.constantFrom("genre", "person", "tag"), op: fc.constantFrom("empty", "defined") }),
);

const date_leaf = fc.record({
  field: fc.constantFrom("added", "last_seen"),
  op: fc.constantFrom("in_last", "not_in_last"),
  value: fc.record({ count: fc.integer({ min: 1, max: 400 }), unit: fc.constantFrom("hour", "day", "week", "month", "year") }),
});

const other_leaf = fc.oneof(
  fc.record({ field: fc.constantFrom("year", "rating", "shelf"), op: fc.constantFrom("top", "bottom"), value: fc.integer({ min: 0, max: 40 }) }),
  fc.record({ field: fc.constant(""), op: fc.constant("in_list"), value: fc.constantFrom(...LISTS, "none") }),
  fc.record({ field: fc.constant("has_files"), op: fc.constant("is"), value: fc.boolean() }),
  fc.record({ field: fc.constant(""), op: fc.constant("in_filter"), value: fc.constantFrom(...Object.keys(saved)) }),
);

const leaf_arbitrary = fc.oneof(text_leaf, regex_leaf, number_leaf, set_leaf, date_leaf, other_leaf) as fc.Arbitrary<LeafNode>;

const filter_arbitrary: fc.Arbitrary<FilterNode> = fc.letrec<{ node: FilterNode }>((tie) => ({
  node: fc.oneof(
    { weight: 5, arbitrary: leaf_arbitrary },
    { weight: 2, arbitrary: fc.record({ op: fc.constantFrom("and" as const, "or" as const), children: fc.array(tie("node"), { maxLength: 3 }) }) },
    { weight: 1, arbitrary: tie("node").map((child) => ({ op: "not" as const, children: [child] })) },
  ),
})).node;

// ── Agreement ────────────────────────────────────────────────────────────────

describe("filter: SQL and memory agree", () => {
  let corpus: Corpus;

  beforeAll(() => {
    corpus = open_corpus(300, 1337);
  });

  afterAll(() => corpus.database.close());

  it("picks the same ids for any filter", () => {
    fc.assert(
      fc.property(filter_arbitrary, (filter) => {
        const query = compile_filter(catalogue, filter, { now: FIXED_NOW, resolve });
        const by_sql = query_rows<{ id: string }>(corpus.database, query).map((row) => row.id).sort();
        const in_memory = select_ids(catalogue, filter, corpus.records, { now: FIXED_NOW, resolve }).map(String).sort();

        expect(in_memory).toEqual(by_sql);
      }),
      { numRuns: 600 },
    );
  }, 30_000);

  it("compiles a filter read back from JSON to the same query", () => {
    fc.assert(
      fc.property(filter_arbitrary, (filter) => {
        const revived = JSON.parse(JSON.stringify(filter)) as FilterNode;

        expect(compile_filter(catalogue, revived, { now: FIXED_NOW, resolve })).toEqual(compile_filter(catalogue, filter, { now: FIXED_NOW, resolve }));
      }),
      { numRuns: 200 },
    );
  });
});
