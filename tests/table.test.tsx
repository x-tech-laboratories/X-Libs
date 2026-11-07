// @vitest-environment jsdom
import "./dom_stubs.ts";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataTable, type Sorting, type TableColumn } from "../src/web/react/table.tsx";
import { move_column, ordered_columns, sort_after_click, sorted_rows, sorted_tree, type SortableColumn } from "../src/web/tables.ts";

afterEach(cleanup);

// ============================================================================
// Rows
// ============================================================================

interface Task {
  id: string;
  title: string;
  size: number | null;
  children?: Task[];
}

const tasks: Task[] = [
  { id: "b", title: "Bake", size: 2, children: [{ id: "b2", title: "Weigh", size: 1 }, { id: "b1", title: "Mix", size: 1 }] },
  { id: "a", title: "Answer", size: null },
  { id: "c", title: "Clean", size: 2, children: [{ id: "c1", title: "Dust", size: 3 }, { id: "c2", title: "Air", size: null }] },
];

const sortable: SortableColumn<Task>[] = [
  { label: "Title", sort: (task) => task.title },
  { label: "Size", sort: (task) => task.size },
];

const columns: TableColumn<Task>[] = [
  { label: "Title", cell: (task) => task.title, sort: (task) => task.title },
  { label: "Size", id: "size", cell: (task) => task.size ?? "", sort: (task) => task.size, min_width: 60, max_width: 200 },
  { label: "Note", cell: () => "" },
];

const titles = (rows: { title: string }[]) => rows.map((row) => row.title);
const shown_titles = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent!.replace(/[▸▾\d]/g, ""));
const header_labels = () => screen.getAllByRole("columnheader").map((cell) => cell.textContent!.replace(/[↑↓\d]/g, "").trim());

// ============================================================================
// Sorting rules
// ============================================================================

describe("sorting rules", () => {
  it("sorts by one column on a click, and adds, flips and drops columns on Shift+click", () => {
    const by_title: Sorting = { key: "Title", descending: false };
    const by_size: Sorting = { key: "Size", descending: false };

    expect(sort_after_click([], "Title", false)).toEqual([by_title]);
    expect(sort_after_click([by_title], "Title", false)).toEqual([{ key: "Title", descending: true }]);
    expect(sort_after_click([{ key: "Title", descending: true }], "Title", false)).toEqual([]);
    expect(sort_after_click([by_title, by_size], "Title", false)).toEqual([by_title]);
    expect(sort_after_click([by_title], "Size", true)).toEqual([by_title, by_size]);
    expect(sort_after_click([by_title, by_size], "Size", true)).toEqual([by_title, { key: "Size", descending: true }]);
    expect(sort_after_click([by_title, { key: "Size", descending: true }], "Size", true)).toEqual([by_title]);
  });

  it("breaks ties with the next column and keeps empty values last either way", () => {
    const sorting: Sorting[] = [{ key: "Size", descending: true }, { key: "Title", descending: false }];

    expect(titles(sorted_rows(sortable, tasks, sorting))).toEqual(["Bake", "Clean", "Answer"]);
    expect(titles(sorted_rows(sortable, tasks, { key: "Size", descending: false }))).toEqual(["Bake", "Clean", "Answer"]);
  });

  it("sorts each level of a tree on its own so children stay under their parents", () => {
    const tree = sorted_tree(sortable, tasks, [{ key: "Size", descending: true }, { key: "Title", descending: true }], (task) => task.children);

    expect(titles(tree.map((node) => node.row))).toEqual(["Clean", "Bake", "Answer"]);
    expect(titles(tree[0]!.children.map((node) => node.row))).toEqual(["Dust", "Air"]);
    expect(titles(tree[1]!.children.map((node) => node.row))).toEqual(["Weigh", "Mix"]);
  });

  it("keeps saved column order, placing new columns after their neighbour, and moves a column", () => {
    expect(ordered_columns(["c", "a", "gone"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
    expect(move_column(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
    expect(move_column(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
  });
});

// ============================================================================
// Headers
// ============================================================================

describe("table headers", () => {
  it("keeps the single sort, the phone labels and the header scope", () => {
    const on_sort = vi.fn();
    render(<DataTable columns={columns} rows={tasks} row_key={(task) => task.id} sorting={{ key: "Title", descending: false }} on_sort={on_sort} />);

    fireEvent.click(screen.getByRole("button", { name: /Title/ }));

    expect(on_sort).toHaveBeenCalledWith({ key: "Title", descending: true });
    expect(screen.getAllByRole("columnheader")[0]!.getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getAllByRole("columnheader")[0]!.getAttribute("scope")).toBe("col");
    expect(screen.getAllByRole("cell")[1]!.dataset.label).toBe("Size");
    expect(shown_titles()).toEqual(["Answer", "Bake", "Clean"]);
  });

  it("adds a column to the sort on Shift+click and ranks the sorted columns", () => {
    const on_sorting_change = vi.fn();
    render(<DataTable columns={columns} rows={tasks} sorting={[{ key: "size", descending: true }, { key: "Title", descending: false }]} on_sorting_change={on_sorting_change} />);

    fireEvent.click(screen.getByRole("button", { name: /Title/ }), { shiftKey: true });

    expect(on_sorting_change).toHaveBeenCalledWith([{ key: "size", descending: true }, { key: "Title", descending: true }]);
    expect(document.querySelectorAll(".sort-rank")).toHaveLength(2);
    expect(screen.getAllByRole("columnheader")[1]!.querySelector(".sort-rank")!.textContent).toBe("1");
  });

  it("shows columns in the saved order and moves one with Alt and an arrow", () => {
    const on_column_order_change = vi.fn();
    render(<DataTable columns={columns} rows={tasks} column_order={["size", "Title", "Note"]} on_column_order_change={on_column_order_change} on_sort={() => {}} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /Size/ }), { key: "ArrowRight", altKey: true });

    expect(header_labels()).toEqual(["Size", "Title", "Note"]);
    expect(on_column_order_change).toHaveBeenCalledWith(["Title", "size", "Note"]);
  });

  it("sets saved widths and resizes a column within its limits", () => {
    const on_column_widths_change = vi.fn();
    render(<DataTable columns={columns} rows={tasks} column_widths={{ size: 190 }} on_column_widths_change={on_column_widths_change} />);

    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the Size column" }), { key: "ArrowRight" });

    expect(screen.getAllByRole("columnheader")[1]!.style.width).toBe("190px");
    expect(on_column_widths_change).toHaveBeenCalledWith({ size: 200 }, true);
  });

  it("hides the hidden columns and offers every column in the Columns menu", () => {
    const on_hidden_columns_change = vi.fn();
    render(<DataTable columns={columns} rows={tasks} hidden_columns={["Note"]} on_hidden_columns_change={on_hidden_columns_change} />);

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Note" }));

    expect(header_labels()).toEqual(["Title", "Size"]);
    expect(screen.getByRole("menuitemcheckbox", { name: "Title" }).getAttribute("aria-checked")).toBe("true");
    expect(on_hidden_columns_change).toHaveBeenCalledWith([]);
  });

  it("opens a column's filter from its funnel and keeps only the rows that pass", () => {
    const filtered: TableColumn<Task>[] = [{ ...columns[0]!, filter: (close) => <button onClick={close}>Only B</button>, filter_active: true }, columns[1]!];
    const on_clear_filters = vi.fn();
    render(<DataTable columns={filtered} rows={tasks} row_passes={(task) => task.title.startsWith("B")} on_clear_filters={on_clear_filters} />);

    const funnel = screen.getByRole("button", { name: "Filter by Title" });
    fireEvent.click(funnel);

    expect(funnel.className).toContain("active");
    expect(document.querySelector('[role="dialog"][aria-label="Filter by Title"]')!.textContent).toBe("Only B");
    expect(shown_titles()).toEqual(["Bake"]);

    fireEvent.click(screen.getByRole("button", { name: "Only B" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(on_clear_filters).toHaveBeenCalled();
  });
});

// ============================================================================
// Trees
// ============================================================================

describe("table trees", () => {
  it("sorts each level and keeps children under their parents", () => {
    render(<DataTable columns={columns} rows={tasks} row_key={(task) => task.id} get_children={(task) => task.children} sorting={[{ key: "size", descending: true }, { key: "Title", descending: true }]} on_sorting_change={() => {}} />);

    expect(shown_titles()).toEqual(["Clean", "Dust", "Air", "Bake", "Weigh", "Mix", "Answer"]);
  });

  it("collapses a row, hiding its children and showing how many there are", () => {
    const on_expanded_change = vi.fn();
    const { rerender } = render(<DataTable columns={columns} rows={tasks} row_key={(task) => task.id} get_children={(task) => task.children} expanded={true} on_expanded_change={on_expanded_change} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Collapse" })[0]!);
    expect(on_expanded_change).toHaveBeenCalledWith(["c"]);

    rerender(<DataTable columns={columns} rows={tasks} row_key={(task) => task.id} get_children={(task) => task.children} expanded={["c"]} on_expanded_change={on_expanded_change} />);

    expect(shown_titles()).toEqual(["Bake", "Answer", "Clean", "Dust", "Air"]);
    expect(document.querySelector(".tree-count")!.textContent).toBe("2");
    expect(screen.getByRole("button", { name: "Expand" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a parent whose child passes the filter", () => {
    render(<DataTable columns={columns} rows={tasks} row_key={(task) => task.id} get_children={(task) => task.children} row_passes={(task) => task.title === "Dust"} />);

    expect(shown_titles()).toEqual(["Clean", "Dust"]);
  });
});

// ============================================================================
// Rows that come sorted, and rows worked by keyboard
// ============================================================================

describe("table rows from a sorted source", () => {
  const plain_columns: TableColumn<Task>[] = [
    { label: "Title", cell: (task) => task.title },
    { label: "Size", id: "size", cell: (task) => task.size ?? "" },
    { label: "Note", cell: () => "", sortable: false },
  ];
  const flat = tasks.map(({ children: _children, ...task }) => task);

  it("keeps the rows' own order while showing and changing the sort", () => {
    const on_sorting_change = vi.fn();
    render(<DataTable manual_sorting columns={plain_columns} rows={flat} sorting={[{ key: "size", descending: true }]} on_sorting_change={on_sorting_change} />);

    expect(shown_titles()).toEqual(["Bake", "Answer", "Clean"]);
    expect(screen.getAllByRole("columnheader")[1]!.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(screen.getByRole("button", { name: /Title/ }), { shiftKey: true });
    expect(on_sorting_change).toHaveBeenCalledWith([{ key: "size", descending: true }, { key: "Title", descending: false }]);
    expect(screen.queryByRole("button", { name: /Note/ })).toBeNull();
  });

  it("keeps a sort key that names no column when another is added", () => {
    const on_sorting_change = vi.fn();
    render(<DataTable manual_sorting columns={plain_columns} rows={flat} sorting={[{ key: "disc", descending: false }]} on_sorting_change={on_sorting_change} />);

    fireEvent.click(screen.getByRole("button", { name: /Size/ }), { shiftKey: true });

    expect(on_sorting_change).toHaveBeenCalledWith([{ key: "disc", descending: false }, { key: "size", descending: false }]);
  });
});

describe("table rows by keyboard", () => {
  it("puts only the active row in the Tab order, marks picked rows and hands on keys and double-clicks", () => {
    const on_row_key_down = vi.fn();
    const on_row_double_click = vi.fn();
    const flat = tasks.map(({ children: _children, ...task }) => task);
    render(
      <DataTable columns={columns} rows={flat} row_key={(task) => task.id} active_row="a" row_selected={(task) => task.id === "c"}
        on_row_key_down={on_row_key_down} on_row_double_click={on_row_double_click} />,
    );
    const body_rows = screen.getAllByRole("row").slice(1);

    expect(body_rows.map((row) => row.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(body_rows.map((row) => row.dataset.rowKey)).toEqual(["b", "a", "c"]);
    expect(body_rows.map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);

    fireEvent.keyDown(body_rows[1]!, { key: "Enter" });
    fireEvent.doubleClick(body_rows[2]!);

    expect(on_row_key_down.mock.calls[0]![0]).toMatchObject({ id: "a" });
    expect(on_row_key_down.mock.calls[0]![1].key).toBe("Enter");
    expect(on_row_double_click.mock.calls[0]![0]).toMatchObject({ id: "c" });
  });

  it("leaves rows out of the Tab order when no keys are wanted", () => {
    render(<DataTable columns={columns} rows={tasks} row_key={(task) => task.id} />);
    expect(screen.getAllByRole("row")[1]!.getAttribute("tabindex")).toBeNull();
  });
});
