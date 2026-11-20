// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parse_unified_diff } from "../src/diff_rows.ts";
import { DiffCounts, EditDiff, FileContent, FileDiff } from "../src/web/react/diff.tsx";
import { FileTree, file_tree_folders, file_tree_rows } from "../src/web/react/file_tree.tsx";

afterEach(cleanup);

const lines = (count: number, from = 1) => Array.from({ length: count }, (_, index) => ` same ${from + index}`);
const file = parse_unified_diff(["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,12 +1,12 @@", ...lines(10), "-const lanes = 1;", "+const lanes = 2;", " end", ""].join("\n"))[0]!;

describe("a file's diff", () => {
  it("shows old and new side by side, the changed word marked, and opens a folded stretch", () => {
    render(<FileDiff file={file} layout="split" />);
    const table = screen.getByRole("table", { name: /old on the left and new on the right/ });

    expect(within(table).getByLabelText("removed").textContent).toBe("const lanes = 1;");
    expect(within(table).getByLabelText("added").textContent).toBe("const lanes = 2;");
    expect(within(table).getByText("1").tagName).toBe("MARK");
    expect(within(table).getByText("2").tagName).toBe("MARK");
    expect(within(table).queryByText("same 1")).toBeNull();

    fireEvent.click(within(table).getByRole("button", { name: "Show 7 more unchanged lines" }));

    expect(within(table).getAllByText("same 1")).toHaveLength(2);
  });

  it("shows one column with old and new numbers when unified, and says when there are no lines", () => {
    render(<FileDiff file={file} layout="unified" />);
    const table = screen.getByRole("table", { name: "Changes to a.ts" });

    expect(within(table).getByLabelText("removed").textContent).toBe("−");
    expect(within(table).getByLabelText("added").textContent).toBe("+");
    expect(within(table).getAllByRole("row").some((row) => row.textContent === "11−const lanes = 1;")).toBe(true);
    cleanup();

    render(<FileDiff file={{ ...file, hunks: [] }} layout="split" no_lines_text="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });

  it("marks hunks apart in either layout", () => {
    const two = parse_unified_diff(["diff --git a/b b/b", "--- a/b", "+++ b/b", "@@ -1 +1 @@", "-x", "+y", "@@ -9 +9 @@ tail", "-p", ""].join("\n"))[0]!;
    render(<FileDiff file={two} layout="unified" />);

    expect(screen.getByText("@@ -9 +9 @@ tail")).toBeTruthy();
    cleanup();

    render(<FileDiff file={two} layout="split" />);
    expect(screen.getByText("@@ -1 +1 @@")).toBeTruthy();
  });
});

describe("a file's text and one edit", () => {
  it("numbers each line of a file", () => {
    render(<FileContent path="notes.txt" text={"first\nsecond\n"} />);
    const table = screen.getByRole("table", { name: "Contents of notes.txt" });

    expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual(["1first", "2second"]);
  });

  it("shows an edit's lines out and in, cut short past its limit", () => {
    render(<EditDiff path="a.ts" before={"a\nb\n"} after={"a\nc\nd\ne\n"} limit={3} />);
    const table = screen.getByRole("table", { name: "Change to a.ts" });

    expect(within(table).getByLabelText("removed").textContent).toBe("−");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("2 more lines left out.")).toBeTruthy();
    cleanup();

    render(<EditDiff before="" after="new" />);
    expect(screen.getByRole("table", { name: "Change" })).toBeTruthy();
  });

  it("names the counts for screen readers", () => {
    render(<DiffCounts additions={3} deletions={1} />);

    expect(screen.getByLabelText("3 added, 1 removed").textContent).toBe("+3 −1");
  });
});

describe("the changed files as a tree", () => {
  const files = [
    { path: "src/web/board.tsx", status: "changed" as const, additions: 3, deletions: 1 },
    { path: "src/web/lane.tsx", status: "added" as const, additions: 9, deletions: 0 },
    { path: "README.md", status: "removed" as const, additions: 0, deletions: 4 },
  ];

  it("puts folders before files, each folder once", () => {
    expect(file_tree_rows(files).map((row) => [row.id, row.parent_id])).toEqual([
      ["folder:src", null],
      ["folder:src/web", "folder:src"],
      ["file:src/web/board.tsx", "folder:src/web"],
      ["file:src/web/lane.tsx", "folder:src/web"],
      ["file:README.md", null],
    ]);
    expect(file_tree_folders(files)).toEqual(["src", "src/web"]);
  });

  it("shows each file's status and counts, picks a file by click or keys, folds folders and filters", async () => {
    const on_select = vi.fn();
    render(<FileTree files={files} selected="src/web/board.tsx" on_select={on_select} extra={(each) => each.path === "README.md" && <span>seen</span>} />);
    const tree = screen.getByRole("tree", { name: "Changed files" });

    expect(within(tree).getByTitle("Modified").textContent).toBe("M");
    expect(within(tree).getByTitle("Deleted").textContent).toBe("D");
    expect(within(tree).getByText("seen")).toBeTruthy();
    fireEvent.click(within(tree).getByText("lane.tsx"));
    expect(on_select).toHaveBeenCalledWith("src/web/lane.tsx");
    fireEvent.keyDown(within(tree).getByText("README.md").closest("[role=treeitem]")!, { key: "Enter" });
    expect(on_select).toHaveBeenCalledWith("README.md");

    fireEvent.click(within(tree).getByText("web/"));
    expect(within(tree).queryByText("lane.tsx")).toBeNull();
    fireEvent.click(within(tree).getByText("web/"));
    expect(within(tree).getByText("lane.tsx")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter files" }), { target: { value: "lane" } });
    await waitFor(() => expect(screen.queryByText("README.md")).toBeNull());
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter files" }), { target: { value: "nothing" } });
    expect(await screen.findByText("No file matches.")).toBeTruthy();
  });

  it("starts with the folders asked for folded, and says when there are no files", () => {
    render(<FileTree files={[{ path: "docs/guide.md" }]} selected={null} on_select={() => undefined} folded={(folder) => folder === "docs"} />);

    expect(screen.queryByText("guide.md")).toBeNull();
    cleanup();

    render(<FileTree files={[]} selected={null} on_select={() => undefined} />);
    expect(screen.getByText("No files.")).toBeTruthy();
  });
});
