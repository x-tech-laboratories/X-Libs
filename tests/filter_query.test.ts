import { describe, expect, test } from "vitest";

import { and, define_catalogue, evaluate, leaf, not, or, type FilterNode, type FilterRecord } from "../src/filter.ts";
import { parse_filter_query, without_term, type QueryField } from "../src/filter_query.ts";

// ── A small music library ────────────────────────────────────────────────────

const fields: QueryField[] = [
  { field: "title", kind: "text", names: ["title", "t"], label: "Title" },
  { field: "genre", kind: "set", names: ["genre", "g"], label: "Genre", values: ["Jazz", "Acid Jazz", "Blues"] },
  { field: "rating", kind: "number", names: ["rating"], label: "Rating", parse_number: (text) => (/^\d+$/.test(text) && Number(text) <= 5 ? Number(text) * 20 : null) },
  { field: "year", kind: "number", names: ["year", "y"], label: "Year" },
  { field: "added", kind: "date", names: ["added"], label: "Added" }
];

const options = { fields, text: (words: string) => leaf("title", "contains", words) };

const parse = (text: string) => parse_filter_query(text, options);

const catalogue = define_catalogue({
  table: "tracks",
  fields: {
    title: { kind: "column", column: "title" },
    genre: { kind: "set", table: "track_genres", row_column: "track_id", value_column: "genre" },
    rating: { kind: "column", column: "rating" },
    year: { kind: "column", column: "year" },
    added: { kind: "column", column: "added" }
  }
});

const now = new Date(2026, 10, 24, 12).getTime();
const day = 24 * 60 * 60 * 1000;

const tracks: FilterRecord[] = [
  { id: "so-what", values: { title: "So What", genre: ["Jazz"], rating: 100, year: 1959, added: new Date(2024, 2, 15, 18).getTime() } },
  { id: "live-blues", values: { title: "Live at the Fillmore", genre: ["Blues"], rating: 60, year: 1968, added: now - 3 * day } },
  { id: "groove", values: { title: "Groove Live", genre: ["Acid Jazz"], rating: null, year: 1994, added: new Date(2024, 3, 1).getTime() } }
];

const matching = (node: FilterNode): string[] => tracks.filter((track) => evaluate(catalogue, node, track, { now })).map((track) => String(track.id));

// ── Terms ────────────────────────────────────────────────────────────────────

describe("parse_filter_query", () => {
  test("reads plain words with the app's text search, each its own term", () => {
    const parsed = parse('so "the fillmore"');

    expect(parsed.node).toEqual(and(leaf("title", "contains", "so"), leaf("title", "contains", "the fillmore")));
    expect(parsed.terms.map((term) => term.label)).toEqual(['"so"', '"the fillmore"']);
    expect(parsed.terms.every((term) => term.understood)).toBe(true);
  });

  test("matches everything for empty text, and gives a lone term's filter as it is", () => {
    expect(parse("   ").node).toEqual(and());
    expect(parse("so").node).toEqual(leaf("title", "contains", "so"));
  });

  test("reads a text field: contains, exact with =, either of a list, and a pattern", () => {
    expect(parse("title:what").node).toEqual(leaf("title", "contains", "what"));
    expect(parse('t="so what"').node).toEqual(leaf("title", "is", "so what"));
    expect(parse("title:so,groove").node).toEqual(or(leaf("title", "contains", "so"), leaf("title", "contains", "groove")));
    expect(parse("title:/^Live at/").node).toEqual(leaf("title", "regex", "^Live at"));
    expect(parse("Title:what").terms[0]!.label).toBe("Title contains \"what\"");
  });

  test("keeps the spaces inside quotes and patterns", () => {
    const parsed = parse('title:"so what" title:/live at/ blues');

    expect(parsed.terms.map((term) => term.source)).toEqual(['title:"so what"', "title:/live at/", "blues"]);
  });

  test("finds a set field's values whatever their case, exactly or by what they contain", () => {
    expect(parse("genre=jazz").node).toEqual(leaf("genre", "any", ["Jazz"]));
    expect(parse("genre:jazz").node).toEqual(leaf("genre", "any", ["Jazz", "Acid Jazz"]));
    expect(parse("g:jazz,blues").node).toEqual(leaf("genre", "any", ["Jazz", "Acid Jazz", "Blues"]));
    expect(parse("genre:polka").node).toEqual(leaf("genre", "any", ["polka"]));
  });

  test("reads numbers with comparisons, ranges and the field's own units", () => {
    expect(parse("rating:>3").node).toEqual(leaf("rating", ">", 60));
    expect(parse("rating:>=4").node).toEqual(leaf("rating", ">=", 80));
    expect(parse("rating:5").node).toEqual(leaf("rating", "is", 100));
    expect(parse("year:1965..1970").node).toEqual(leaf("year", "between", [1965, 1970]));
    expect(parse("year=1959").node).toEqual(leaf("year", "is", 1959));
    expect(parse("rating:>3").terms[0]!.label).toBe("Rating over 3");
  });

  test("reads dates relative to now and as whole years, months or days", () => {
    const march = { from: new Date(2024, 2, 1).getTime(), until: new Date(2024, 3, 1).getTime() };

    expect(parse("added:<30d").node).toEqual(leaf("added", "in_last", { count: 30, unit: "day" }));
    expect(parse("added:>6m").node).toEqual(leaf("added", "not_in_last", { count: 6, unit: "month" }));
    expect(parse("added:2024-03").node).toEqual(and(leaf("added", ">=", march.from), leaf("added", "<", march.until)));
    expect(parse("added:>2024-03").node).toEqual(leaf("added", ">=", march.until));
    expect(parse("added:<2024").node).toEqual(leaf("added", "<", new Date(2024, 0, 1).getTime()));
    expect(parse("added:2024-03..2024-04").node).toEqual(and(leaf("added", ">=", march.from), leaf("added", "<", new Date(2024, 4, 1).getTime())));
    expect(parse("added:<30d").terms[0]!.label).toBe("Added in the last 30 days");
  });

  test("keeps dates in the field's clock", () => {
    const seconds = parse_filter_query("added:2024", { ...options, fields: [{ ...fields[4]!, clock: "seconds" }] });
    const iso = parse_filter_query("added:2024", { ...options, fields: [{ ...fields[4]!, clock: "iso" }] });

    expect(seconds.node).toEqual(and(leaf("added", ">=", new Date(2024, 0, 1).getTime() / 1000), leaf("added", "<", new Date(2025, 0, 1).getTime() / 1000)));
    expect(iso.node).toEqual(and(leaf("added", ">=", new Date(2024, 0, 1).toISOString()), leaf("added", "<", new Date(2025, 0, 1).toISOString())));
  });

  test("leaves out what a term matches when it starts with -", () => {
    const parsed = parse("-live -genre:blues");

    expect(parsed.node).toEqual(and(not(leaf("title", "contains", "live")), not(leaf("genre", "any", ["Blues"]))));
    expect(parsed.terms.map((term) => term.label)).toEqual(['not "live"', 'not Genre has "blues"']);
    expect(parse("-").node).toEqual(leaf("title", "contains", "-"));
  });

  test("searches a condition it cannot read as words, and says it did not understand it", () => {
    for (const text of ["rating:>lots", "added:yesterday", "year:", "title:/(/", "genre:/jazz/", "added:2024-13"]) {
      const term = parse(text).terms[0]!;
      expect(term.understood, text).toBe(false);
      expect(term.node, text).toEqual(leaf("title", "contains", text));
    }
  });

  test("searches an unknown field's name as words, which is understood", () => {
    const term = parse("mood:happy").terms[0]!;

    expect(term.node).toEqual(leaf("title", "contains", "mood:happy"));
    expect(term.understood).toBe(true);
  });
});

// ── Against the filter engine ────────────────────────────────────────────────

describe("what a parsed filter matches", () => {
  test("gives the tracks each kind of term describes", () => {
    expect(matching(parse("live").node)).toEqual(["live-blues", "groove"]);
    expect(matching(parse("live -genre:blues").node)).toEqual(["groove"]);
    expect(matching(parse("genre:jazz").node)).toEqual(["so-what", "groove"]);
    expect(matching(parse("genre=jazz").node)).toEqual(["so-what"]);
    expect(matching(parse("rating:>=3 year:1950..1970").node)).toEqual(["so-what", "live-blues"]);
    expect(matching(parse("added:<7d").node)).toEqual(["live-blues"]);
    expect(matching(parse("added:2024-03-15").node)).toEqual(["so-what"]);
    expect(matching(parse("added:<2024-04").node)).toEqual(["so-what"]);
    expect(matching(parse("title:/^So/").node)).toEqual(["so-what"]);
    expect(matching(parse("title:/^so/").node)).toEqual([]);
  });
});

// ── Taking a term out ────────────────────────────────────────────────────────

describe("without_term", () => {
  test("takes one term out of the text and tidies the spaces", () => {
    const text = "live  genre:jazz rating:>3";
    const [, genre] = parse(text).terms;

    expect(without_term(text, genre!)).toBe("live rating:>3");
  });
});
