import { describe, expect, it } from "vitest";

import { chunk_text, dot, from_blob, fts_query, fuse_ranks, text_hash, to_blob, unit } from "../src/text_index.ts";

describe("the index's text helpers", () => {
  it("cut long text into overlapping pieces at spaces, and keep short text whole", () => {
    expect(chunk_text("  short  ")).toEqual(["short"]);
    expect(chunk_text("   ")).toEqual([]);
    const words = Array.from({ length: 400 }, (_, at) => `word${at}`).join(" ");
    const pieces = chunk_text(words, 500, 100);
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.every((piece) => piece.length <= 500)).toBe(true);
    // Each piece starts with words the one before ended with.
    expect(pieces[1]!.includes(pieces[0]!.split(" ").at(-1)!)).toBe(true);
    expect(pieces.join(" ")).toContain("word399");
    expect(chunk_text("x".repeat(1000), 400, 50).every((piece) => piece.length <= 400)).toBe(true);
  });

  it("quote each word of a query, hash text, fuse rankings and keep vectors as blobs", () => {
    expect(fts_query('tiles "OR" grout-colour')).toBe('"tiles"* AND "or"* AND "grout"* AND "colour"*');
    expect(fts_query("a b", "OR")).toBe('"a"* OR "b"*');
    expect(fts_query("!!")).toBe("");
    expect(text_hash("a")).not.toBe(text_hash("b"));
    expect(text_hash("same")).toBe(text_hash("same"));
    const fused = fuse_ranks([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect([...fused].sort((first, second) => second[1] - first[1]).map(([key]) => key)).toEqual(["b", "a", "c"]);
    const vector = unit([3, 4]);
    expect([...from_blob(to_blob(vector))]).toEqual([Math.fround(0.6), Math.fround(0.8)]);
    expect(dot(vector, unit([3, 4]))).toBeCloseTo(1);
    expect([...unit([0, 0])]).toEqual([0, 0]);
  });
});
