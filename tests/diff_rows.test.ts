import { describe, expect, it } from "vitest";

import { diff_totals, diff_within_limit, edit_lines, fold_rows, parse_unified_diff, split_rows, unified_rows, word_parts } from "../src/diff_rows.ts";

const lines = (count: number, from = 1) => Array.from({ length: count }, (_, index) => ` same ${from + index}`);

// A file of twenty lines with one line changed in the middle and one added at the end, shown whole.
const file = parse_unified_diff(
  ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,20 +1,21 @@", ...lines(9), "-const lanes = 1;", "+const lanes = 2;", ...lines(10, 11), "+tail();", ""].join("\n"),
)[0]!;

describe("reading a unified diff", () => {
  it("names each file's status, paths and counts, and numbers its lines on both sides", () => {
    const text = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-gone",
      "+here",
      "\\ No newline at end of file",
      "diff --git a/fresh.ts b/fresh.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/fresh.ts",
      "@@ -0,0 +1 @@",
      "+hello",
      "diff --git a/dead.ts b/dead.ts",
      "deleted file mode 100644",
      "--- a/dead.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/same.ts b/same.ts",
      "--- a/same.ts",
      "+++ b/same.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "",
    ].join("\n");

    const files = parse_unified_diff(text);

    expect(files.map((each) => [each.path, each.old_path, each.status])).toEqual([
      ["new.ts", "old.ts", "renamed"],
      ["fresh.ts", "fresh.ts", "added"],
      ["dead.ts", "dead.ts", "removed"],
      ["same.ts", "same.ts", "changed"],
    ]);
    expect(files[0]!.hunks[0]!.lines).toEqual([
      { kind: "context", text: "keep", old_number: 1, new_number: 1 },
      { kind: "removed", text: "gone", old_number: 2, new_number: null },
      { kind: "added", text: "here", old_number: null, new_number: 2 },
    ]);
    expect(diff_totals(files)).toEqual({ additions: 3, deletions: 3 });
  });

  it("cuts a long diff at the last whole file within the limit", () => {
    const text = "diff --git a/a b/a\n+one\ndiff --git a/b b/b\n+two\n";

    expect(diff_within_limit(text, 1000)).toEqual({ text, truncated: false });
    expect(diff_within_limit(text, 30)).toEqual({ text: "diff --git a/a b/a\n+one\n", truncated: true });
    expect(diff_within_limit(text, 5)).toEqual({ text: "", truncated: true });
  });
});

describe("a file's diff laid out", () => {
  it("side by side, a changed line paired with its new one and the changed word marked", () => {
    const rows = split_rows(file);

    expect(rows).toHaveLength(21);
    expect(rows[9]).toEqual({
      kind: "change",
      left: { number: 10, parts: [{ text: "const lanes = ", changed: false }, { text: "1", changed: true }, { text: ";", changed: false }] },
      right: { number: 10, parts: [{ text: "const lanes = ", changed: false }, { text: "2", changed: true }, { text: ";", changed: false }] },
    });
    expect(rows[20]).toEqual({ kind: "change", left: null, right: { number: 21, parts: [{ text: "tail();", changed: false }] } });
  });

  it("in one column, removed lines before added ones", () => {
    const rows = unified_rows(file);

    expect(rows.slice(9, 11).map((row) => row.kind !== "hunk" && [row.kind, row.old_number, row.new_number])).toEqual([
      ["removed", 10, null],
      ["added", null, 10],
    ]);
  });

  it("folds long unchanged stretches down to three lines beside each change, unless opened", () => {
    const folded = fold_rows(split_rows(file), new Set());

    expect(folded.map((row) => row.kind)).toEqual(["fold", "same", "same", "same", "change", "same", "same", "same", "fold", "same", "same", "same", "change"]);
    expect(folded[0]).toEqual({ kind: "fold", start: 0, count: 6 });
    expect(folded[8]).toEqual({ kind: "fold", start: 10, count: 4 });
    expect(fold_rows(split_rows(file), new Set([0, 10]))).toHaveLength(21);
  });

  it("leaves a stretch of one hidden line shown, as a fold would hide no more than it shows", () => {
    const rows = [{ kind: "change" }, ...Array.from({ length: 7 }, () => ({ kind: "same" })), { kind: "change" }];

    expect(fold_rows(rows, new Set()).map((row) => row.kind)).not.toContain("fold");
  });

  it("marks hunks apart when a file has several, a lone removed line staying unpaired", () => {
    const two = parse_unified_diff(["diff --git a/b b/b", "--- a/b", "+++ b/b", "@@ -1 +1 @@", "-x", "+y", "@@ -9,2 +9 @@ end", "-p", "-q", "+r", ""].join("\n"))[0]!;

    expect(split_rows(two).map((row) => row.kind)).toEqual(["hunk", "change", "hunk", "change", "change"]);
    expect(split_rows(two)[4]).toEqual({ kind: "change", left: { number: 10, parts: [{ text: "q", changed: false }] }, right: null });
    expect(unified_rows(two)[0]).toEqual({ kind: "hunk", header: "@@ -1 +1 @@" });
  });
});

describe("the words of a changed line", () => {
  it("are left whole when nothing but spaces stayed the same", () => {
    expect(word_parts("alpha beta", "gamma delta")).toEqual({ old: [{ text: "alpha beta", changed: false }], new: [{ text: "gamma delta", changed: false }] });
  });
});

describe("a before and after text", () => {
  it("is lines kept, taken out and put in", () => {
    expect(edit_lines("a\nb\nc\n", "a\nB\nc\n")).toEqual([
      { kind: "context", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "context", text: "c" },
    ]);
    expect(edit_lines("", "new")).toEqual([{ kind: "added", text: "new" }]);
  });
});
