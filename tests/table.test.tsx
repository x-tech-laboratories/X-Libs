// @vitest-environment jsdom
import "./dom_stubs.ts";

import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
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

// ============================================================================
// Groups
// ============================================================================

const body_rows = () => [...document.querySelectorAll("tbody tr")].map((row) => row.classList.contains("group-row") ? `# ${row.textContent}` : within(row as HTMLElement).getAllByRole("cell")[0]!.textContent);

describe("table groups", () => {
  const groups = [
    { key: "now", label: "Now", rows: [tasks[1]!, tasks[0]!], class_name: "group-now" },
    { key: "later", label: "Later", rows: [tasks[2]!] },
  ];

  it("shows each group under its heading, sorted on its own", () => {
    render(<DataTable columns={columns} rows={[]} groups={groups} row_key={(task) => task.id} sorting={{ key: "Title", descending: true }} on_sort={() => {}} />);

    expect(body_rows()).toEqual(["# Now", "Bake", "Answer", "# Later", "Clean"]);
    const heading = screen.getByRole("columnheader", { name: "Now" });
    expect(heading.getAttribute("scope")).toBe("colgroup");
    expect(heading.getAttribute("colspan")).toBe("3");
    expect(heading.parentElement!.className).toBe("group-row group-now");
  });

  it("nests and filters within each group", () => {
    render(<DataTable columns={columns} rows={[]} groups={groups} row_key={(task) => task.id} get_children={(task) => task.children} row_passes={(task) => task.title !== "Answer" && task.title !== "Dust"} />);

    expect(body_rows().map((title) => title!.replace(/[▸▾\d]/g, ""))).toEqual(["# Now", "Bake", "Weigh", "Mix", "# Later", "Clean", "Air"]);
  });

  it("hides the heading of a group the filter empties, but keeps one empty all along", () => {
    const with_empty = [...groups, { key: "someday", label: "Someday", rows: [] }];
    render(<DataTable columns={columns} rows={[]} groups={with_empty} row_key={(task) => task.id} row_passes={(task) => task.title === "Clean"} />);

    expect(body_rows()).toEqual(["# Later", "Clean", "# Someday"]);
  });
});

// ============================================================================
// Rows
// ============================================================================

// jsdom has no drag events or layout, so the drag carries its own clientY and each row a fixed 40px box.
function drag_row(title: string, type: "dragStart" | "dragOver" | "drop" | "dragEnd", client_y = 0): void {
  const row = screen.getByText(title).closest("tr")!;
  row.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) });
  const event = createEvent[type](row, { dataTransfer: { types: [], setData: () => {} } });
  Object.defineProperty(event, "clientY", { value: client_y });
  fireEvent(row, event);
}

const row_of = (title: string) => screen.getByText(title).closest("tr")!;

describe("table rows", () => {
  it("gives a row the style the app asks for, such as a tint its cells read", () => {
    render(<DataTable columns={columns} rows={tasks} row_style={(task) => (task.id === "a" ? { color: "red" } : undefined)} />);

    expect(row_of("Answer").style.color).toBe("red");
    expect(row_of("Bake").getAttribute("style")).toBeNull();
  });

  it("drops a row dragged in this table before, inside or after another", () => {
    const on_row_drag_start = vi.fn();
    const on_row_drag_end = vi.fn();
    const on_row_drop = vi.fn();
    render(<DataTable columns={columns} rows={tasks} row_key={(task) => task.id} on_row_drag_start={on_row_drag_start} on_row_drag_end={on_row_drag_end} on_row_drop={(row, placement) => on_row_drop(row.id, placement)} />);

    expect(row_of("Answer").getAttribute("draggable")).toBe("true");
    drag_row("Answer", "dragStart");
    drag_row("Bake", "dragOver", 105);
    expect(row_of("Bake").className).toBe("drop-before");
    drag_row("Bake", "dragOver", 120);
    expect(row_of("Bake").className).toBe("drop-inside");
    drag_row("Bake", "drop", 135);
    drag_row("Answer", "dragEnd");

    expect(on_row_drag_start.mock.calls[0]![0].id).toBe("a");
    expect(on_row_drop.mock.calls).toEqual([["b", "after"]]);
    expect(on_row_drag_end).toHaveBeenCalled();
    expect(row_of("Bake").className).toBe("");
  });

  it("refuses drags from elsewhere unless the app's rule takes them, split in halves without inside drops", () => {
    const on_row_drop = vi.fn();
    const { rerender } = render(<DataTable columns={columns} rows={tasks} on_row_drop={(row, placement) => on_row_drop(row.id, placement)} />);

    drag_row("Bake", "drop", 120);
    expect(on_row_drop).not.toHaveBeenCalled();

    rerender(<DataTable columns={columns} rows={tasks} allow_inside_drop={false} can_drop_on_row={(row) => row.id !== "c"} on_row_drop={(row, placement) => on_row_drop(row.id, placement)} />);
    drag_row("Clean", "drop", 110);
    drag_row("Bake", "dragOver", 115);
    expect(row_of("Bake").className).toBe("drop-before");
    drag_row("Bake", "drop", 125);

    expect(on_row_drop.mock.calls).toEqual([["b", "after"]]);
  });

  it("adds a full-width row after a row, and a title", () => {
    render(<DataTable columns={columns} rows={tasks} row_title={(task) => `Task ${task.id}`} render_after_row={(task) => task.id === "a" ? <input aria-label="New subtask" /> : null} />);

    const extra = screen.getByRole("textbox", { name: "New subtask" }).closest("tr")!;
    expect(extra.className).toBe("row-extra");
    expect(extra.previousElementSibling).toBe(row_of("Answer"));
    expect(extra.firstElementChild!.getAttribute("colspan")).toBe("3");
    expect(document.querySelectorAll(".row-extra")).toHaveLength(1);
    expect(row_of("Clean").title).toBe("Task c");
  });
});

// ============================================================================
// Drawing
// ============================================================================

describe("table drawing", () => {
  it("draws again only the rows whose picking changed", () => {
    const drawn: string[] = [];
    const counted: TableColumn<Task>[] = [{ label: "Title", cell: (task) => { drawn.push(task.id); return task.title; } }];
    const flat = tasks.map(({ children: _children, ...task }) => task);
    const table = (picked: string) => <DataTable columns={counted} rows={flat} row_key={(task) => task.id} row_selected={(task) => task.id === picked} on_row_click={() => {}} />;
    const { rerender } = render(table("a"));
    drawn.length = 0;

    rerender(table("c"));

    expect(drawn.sort()).toEqual(["a", "c"]);
    expect(row_of("Clean").getAttribute("aria-selected")).toBe("true");
  });

  it("lets the last column fill the room the fixed widths leave", () => {
    render(<DataTable columns={columns} rows={tasks} fill_last_column column_widths={{ Title: 200, size: 80, Note: 120 }} on_column_widths_change={() => {}} />);
    const [title, , note] = screen.getAllByRole("columnheader");

    expect(title!.style.width).toBe("200px");
    expect(note!.getAttribute("style")).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize the Note column" })).toBeNull();
    expect(screen.getByRole("table").style.tableLayout).toBe("fixed");
    expect(screen.getByRole("table").classList.contains("fill-last-column")).toBe(true);
  });
});

// ============================================================================
// Virtual rows
// ============================================================================

const many: Task[] = Array.from({ length: 1000 }, (_, index) => ({ id: `r${index}`, title: `Row ${index}`, size: index }));
const drawn_keys = () => [...document.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].map((row) => row.dataset.rowKey);
const spacers = () => [...document.querySelectorAll<HTMLElement>("tbody tr.virtual-spacer")].map((row) => row.style.height);

// jsdom has no layout, so the scroller gets a fixed 400px height and the scroll it is told.
function scroller(scroll_top = 0): HTMLElement {
  const wrap = document.querySelector<HTMLElement>(".table-wrap")!;
  Object.defineProperty(wrap, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(wrap, "scrollTop", { configurable: true, writable: true, value: scroll_top });
  return wrap;
}

describe("table virtual rows", () => {
  const virtual_table = (active: string) => (
    <DataTable columns={columns} rows={many} row_key={(task) => task.id} manual_sorting virtual={{ row_height: 40, overscan: 2 }} active_row={active} on_row_key_down={() => {}} />
  );

  it("draws only the rows in view, with spacers for the rest", () => {
    render(virtual_table("r0"));
    const wrap = scroller(4000);

    fireEvent.scroll(wrap);

    expect(drawn_keys()).toEqual(Array.from({ length: 14 }, (_, index) => `r${98 + index}`));
    expect(spacers()).toEqual(["3920px", `${(1000 - 112) * 40}px`]);
  });

  it("scrolls the active row into view and hands it focus from the row that had it", () => {
    const { rerender } = render(virtual_table("r0"));
    const wrap = scroller();
    fireEvent.scroll(wrap);
    const first = document.querySelector<HTMLElement>('tr[data-row-key="r0"]')!;
    first.focus();

    rerender(virtual_table("r500"));

    expect(wrap.scrollTop).toBe(500 * 40 + 40 - 400);
    expect(document.activeElement).toBe(document.querySelector('tr[data-row-key="r500"]'));
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
  });

  it("draws every row as a card on phones unless a card height is given", () => {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      render(virtual_table("r0"));
      expect(drawn_keys()).toHaveLength(1000);
      expect(spacers()).toEqual([]);
    } finally {
      window.matchMedia = before;
    }
  });
});
