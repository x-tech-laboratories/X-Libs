// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Board, type BoardColumn, type BoardLane, type BoardMove } from "../src/web/react/board.tsx";
import { use_phone } from "../src/web/react/phone.ts";

afterEach(cleanup);

// ============================================================================
// Fixtures
// ============================================================================

interface Note {
  id: string;
  title: string;
  column: string;
}

const kanban_columns: BoardColumn[] = [
  { id: "open", label: "To do" },
  { id: "late", label: "Late", class_name: "tone-bad", accepts_drop: false },
  { id: "done", label: "Done" },
];

const notes: Note[] = [
  { id: "a", title: "Write", column: "open" },
  { id: "b", title: "Read", column: "open" },
  { id: "c", title: "Ship", column: "done" },
];

// A plain board that keeps its own cards and moves them, as an app would.
function Kanban({ on_open, on_move }: { on_open?: (note: Note) => void; on_move?: (note: Note, move: BoardMove<BoardColumn, BoardLane>) => void }) {
  const [shown, set_shown] = useState(notes);
  const columns = kanban_columns.map((column) => ({ ...column, count: shown.filter((note) => note.column === column.id).length }));
  return (
    <Board<Note, BoardColumn>
      label="Notes"
      columns={columns}
      cards={{
        of: (_lane, column) => shown.filter((note) => note.column === column.id),
        id: (note) => note.id,
        render: (note) => note.title,
        on_open: (note) => on_open?.(note),
      }}
      on_move={(note, move) => {
        on_move?.(note, move);
        set_shown((before) => before.map((each) => (each.id === note.id ? { ...each, column: move.to.id } : each)));
      }}
    />
  );
}

const stage_columns: BoardColumn[] = [
  { id: "plan", label: "Plan", title: "Write the plan" },
  { id: "build", label: "Build" },
  { id: "check", label: "Check" },
];

const work: BoardLane[] = [
  { id: "one", label: "First", group: "north", current: "build" },
  { id: "two", label: "Second", group: "south", current: "plan" },
  { id: "three", label: "Third", group: "north", current: "check" },
];

// Starts a drag and lets the board take it up once the browser has pictured the card.
async function start_drag(card: HTMLElement, init: object = {}): Promise<void> {
  fireEvent.dragStart(card, init);
  await act(() => new Promise((resolve) => setTimeout(resolve)));
}

const focused_text = () => (document.activeElement as HTMLElement).textContent;
const press = (key: string, options: Record<string, boolean> = {}) => fireEvent.keyDown(document.activeElement!, { key, ...options });

// ============================================================================
// A plain board
// ============================================================================

describe("Board without lanes", () => {
  it("draws a grid with a head per column, its count, and the cards in their columns", () => {
    render(<Kanban />);

    const grid = screen.getByRole("grid", { name: "Notes" });
    const heads = within(grid).getAllByRole("columnheader");
    expect(heads.map((head) => head.textContent)).toEqual(["To do2", "Late0", "Done1"]);
    expect(heads[1]!.className).toContain("tone-bad");
    expect(within(grid).queryByRole("rowheader")).toBeNull();
    const cells = within(grid).getAllByRole("gridcell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["WriteRead", "", "Ship"]);
  });

  it("opens a card on a click or on Enter", () => {
    const on_open = vi.fn();
    render(<Kanban on_open={on_open} />);

    fireEvent.click(screen.getByText("Ship"));
    screen.getByText("Write").focus();
    press("Enter");

    expect(on_open.mock.calls.map(([note]) => note.id)).toEqual(["c", "a"]);
  });

  it("walks the cards with the arrow keys, keeping one tab stop", () => {
    render(<Kanban />);
    const first = screen.getByText("Write");
    expect(first.tabIndex).toBe(0);
    expect(screen.getByText("Read").tabIndex).toBe(-1);

    first.focus();
    press("ArrowDown");
    expect(focused_text()).toBe("Read");
    press("ArrowDown");
    expect(focused_text()).toBe("Read");
    press("ArrowRight");
    expect(document.activeElement!.getAttribute("role")).toBe("gridcell");
    press("ArrowRight");
    expect(focused_text()).toBe("Ship");
    press("Home");
    expect(focused_text()).toBe("Write");
    press("End");
    expect(focused_text()).toBe("Ship");
    press("ArrowUp");
    expect(focused_text()).toBe("Ship");
    expect(screen.getByText("Ship").tabIndex).toBe(0);
  });

  it("moves a card with Alt and an arrow, past columns that refuse it, and keeps it focused", () => {
    const on_move = vi.fn();
    render(<Kanban on_move={on_move} />);

    screen.getByText("Read").focus();
    press("ArrowRight", { altKey: true });

    expect(on_move).toHaveBeenCalledTimes(1);
    const [note, move] = on_move.mock.calls[0]!;
    expect([note.id, move.lane, move.from.id, move.to.id]).toEqual(["b", null, "open", "done"]);
    expect(focused_text()).toBe("Read");
    expect(screen.getAllByRole("gridcell")[2]!.textContent).toBe("ReadShip");

    press("ArrowRight", { altKey: true });
    expect(on_move).toHaveBeenCalledTimes(1);
  });

  it("moves a dropped card onto a column that takes it, and nowhere else", async () => {
    const on_move = vi.fn();
    render(<Kanban on_move={on_move} />);
    const cells = screen.getAllByRole("gridcell");
    const card = screen.getByText("Write");
    expect(card.draggable).toBe(true);

    await start_drag(card);
    fireEvent.dragOver(cells[1]!);
    expect(cells[1]!.className).not.toContain("drop-inside");
    fireEvent.drop(cells[1]!);
    expect(on_move).not.toHaveBeenCalled();

    await start_drag(card);
    fireEvent.drop(cells[0]!);
    expect(on_move).not.toHaveBeenCalled();

    await start_drag(card);
    fireEvent.dragOver(cells[2]!);
    expect(cells[2]!.className).toContain("drop-inside");
    expect(card.className).toContain("dragging");
    fireEvent.dragLeave(cells[2]!, { relatedTarget: document.body });
    expect(cells[2]!.className).not.toContain("drop-inside");
    fireEvent.drop(cells[2]!);
    expect(on_move.mock.calls.map(([note, move]) => [note.id, move.from.id, move.to.id])).toEqual([["a", "open", "done"]]);
  });

  it("tells the app when a drag starts and ends, lifting the card only for the browser's picture", async () => {
    const started = vi.fn();
    const ended = vi.fn();
    render(
      <Board<Note, BoardColumn>
        label="Notes"
        columns={kanban_columns}
        cards={{ of: () => [notes[0]!], id: (note) => note.id, render: (note) => note.title, on_drag_start: started, on_drag_end: ended }}
      />,
    );
    const card = screen.getAllByText("Write")[0]!;
    expect(card.draggable).toBe(false);

    const set_data = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData: set_data, effectAllowed: "all" } });
    expect(card.className).toContain("drag-preview");
    expect(card.className).not.toContain("dragging");
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(card.className).not.toContain("drag-preview");
    expect(card.className).toContain("dragging");
    fireEvent.dragEnd(card);

    expect(set_data).toHaveBeenCalledWith("text/plain", "a");
    expect(card.className).not.toContain("dragging");

    fireEvent.dragStart(card);
    fireEvent.dragEnd(card);
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(card.className).not.toContain("dragging");
    expect(started.mock.calls[0]![0].id).toBe("a");
    expect(ended).toHaveBeenCalledTimes(2);
  });

  it("hands a card's class, style and context menu to the app", () => {
    const menu = vi.fn();
    render(
      <Board<Note, BoardColumn>
        label="Notes"
        columns={kanban_columns.slice(0, 1)}
        cards={{
          of: () => notes.slice(0, 1),
          id: (note) => note.id,
          render: (note) => note.title,
          class_name: () => "picked",
          style: () => ({ opacity: 0.5 }),
          on_context_menu: menu,
        }}
      />,
    );
    const card = screen.getByText("Write");

    fireEvent.contextMenu(card);

    expect(card.className).toContain("picked");
    expect(card.style.opacity).toBe("0.5");
    expect(menu).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Lanes and groups
// ============================================================================

describe("Board with lanes", () => {
  function Lanes(props: { on_open?: (lane: BoardLane | null, column: BoardColumn | null) => void; on_fold?: (folded: Set<string>) => void; folded?: ReadonlySet<string> }) {
    return (
      <Board<never, BoardColumn>
        label="Work"
        columns={stage_columns}
        lanes={work}
        lane_heading="Item"
        group_label={(key) => `Place ${key}`}
        render_cell={(lane, column) => (lane!.current === column.id ? `${lane!.label} here` : null)}
        on_open={props.on_open}
        folded_groups={props.folded}
        on_folded_groups_change={props.on_fold}
      />
    );
  }

  it("draws a row per lane under its group's heading, with its head and its current column marked", () => {
    render(<Lanes />);

    const grid = screen.getByRole("grid", { name: "Work" });
    expect(within(grid).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Item", "Plan", "Build", "Check"]);
    expect(within(grid).getByRole("columnheader", { name: "Plan" }).title).toBe("Write the plan");
    expect(within(grid).getAllByRole("rowheader").map((head) => head.textContent)).toEqual(["First", "Third", "Second"]);
    expect(within(grid).getAllByRole("button").map((button) => button.textContent)).toEqual(["Place north2", "Place south1"]);
    const current = grid.querySelectorAll("[aria-current='true']");
    expect([...current].map((cell) => cell.textContent)).toEqual(["First here", "Third here", "Second here"]);
    expect(current[0]!.className).toContain("current");
  });

  it("folds a group from its heading, keeping the folds itself", () => {
    render(<Lanes />);
    const north = screen.getByRole("button", { name: /Place north/ });

    fireEvent.click(north);

    expect(north.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByRole("rowheader").map((head) => head.textContent)).toEqual(["Second"]);
  });

  it("hands the folds to the app when it keeps them", () => {
    const on_fold = vi.fn();
    render(<Lanes folded={new Set(["south"])} on_fold={on_fold} />);
    expect(screen.getAllByRole("rowheader").map((head) => head.textContent)).toEqual(["First", "Third"]);

    fireEvent.click(screen.getByRole("button", { name: /Place south/ }));

    expect([...on_fold.mock.calls[0]![0]]).toEqual([]);
    expect(screen.getAllByRole("rowheader")).toHaveLength(2);
  });

  it("walks heads, cells and group headings with the keys, and opens with Enter", () => {
    const on_open = vi.fn();
    render(<Lanes on_open={on_open} />);
    const north = screen.getByRole("button", { name: /Place north/ });
    expect(north.tabIndex).toBe(0);

    north.focus();
    press("ArrowDown");
    expect(focused_text()).toBe("First");
    press("Enter");
    expect(on_open).toHaveBeenLastCalledWith(work[0], null);

    press("ArrowRight");
    press("ArrowRight");
    expect(focused_text()).toBe("First here");
    press("Enter");
    expect(on_open).toHaveBeenLastCalledWith(work[0], stage_columns[1]);

    press("ArrowDown");
    expect(focused_text()).toBe("");
    press("ArrowRight");
    expect(focused_text()).toBe("Third here");
    press("ArrowDown");
    expect(screen.getByRole("button", { name: /Place south/ })).toBe(document.activeElement);
    press("ArrowDown");
    expect(focused_text()).toBe("");
    press("Home");
    expect(focused_text()).toBe("Second");
    press("End");
    expect(document.activeElement!.getAttribute("role")).toBe("gridcell");
    press("Home", { ctrlKey: true });
    expect(north).toBe(document.activeElement);
    press("End", { ctrlKey: true });
    expect(document.activeElement!.getAttribute("role")).toBe("gridcell");
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(focused_text()).toBe("Second");
    press("ArrowUp");
    expect(screen.getByRole("button", { name: /Place south/ })).toBe(document.activeElement);
    press("ArrowUp");
    expect(focused_text()).toBe("Third");
  });

  it("folds and unfolds a group from the keyboard", () => {
    render(<Lanes />);
    const north = screen.getByRole("button", { name: /Place north/ });
    north.focus();

    press("ArrowLeft");
    expect(north.getAttribute("aria-expanded")).toBe("false");
    press("ArrowRight");
    expect(north.getAttribute("aria-expanded")).toBe("true");
    press("Enter");
    expect(north.getAttribute("aria-expanded")).toBe("false");
    press(" ");
    expect(north.getAttribute("aria-expanded")).toBe("true");
    press("End", { ctrlKey: true });
    expect(document.activeElement!.getAttribute("role")).toBe("gridcell");
    press("Home", { ctrlKey: true });
    press("ArrowUp");
    expect(north).toBe(document.activeElement);
  });

  it("leaves keys alone on content inside a cell and with Alt held", () => {
    render(
      <Board<never, BoardColumn> label="Work" columns={stage_columns} lanes={work.slice(0, 1)} render_cell={() => <a href="#x">Link</a>} />,
    );
    const link = screen.getAllByText("Link")[0]!;
    link.focus();
    press("ArrowRight");
    expect(link).toBe(document.activeElement);

    screen.getByText("First").focus();
    press("ArrowRight", { altKey: true });
    expect(focused_text()).toBe("First");
  });

  it("holds several cards per cell in each lane, moving them only where the app allows and within their lane", async () => {
    const on_move = vi.fn();
    const can_move = vi.fn((note: Note, move: BoardMove<BoardColumn, BoardLane>) => !(note.id === "a" && move.to.id === "done"));
    const lanes: BoardLane[] = [{ id: "left", label: "Left" }, { id: "right", label: "Right" }];
    render(
      <Board<Note, BoardColumn>
        label="Work"
        columns={kanban_columns.filter((column) => column.id !== "late")}
        lanes={lanes}
        cards={{ of: (lane, column) => notes.filter((note) => note.column === column.id && (lane!.id === "left") === (note.id !== "c")), id: (note) => note.id, render: (note) => note.title }}
        on_move={on_move}
        can_move={can_move}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    const cells_of = (row: HTMLElement) => within(row).getAllByRole("gridcell");
    expect(cells_of(rows[0]!).map((cell) => cell.textContent)).toEqual(["WriteRead", ""]);
    expect(cells_of(rows[1]!).map((cell) => cell.textContent)).toEqual(["", "Ship"]);

    await start_drag(screen.getByText("Write"));
    fireEvent.dragOver(cells_of(rows[0]!)[1]!);
    expect(cells_of(rows[0]!)[1]!.className).not.toContain("drop-inside");
    fireEvent.drop(cells_of(rows[0]!)[1]!);

    await start_drag(screen.getByText("Read"));
    fireEvent.dragOver(cells_of(rows[1]!)[0]!);
    expect(cells_of(rows[1]!)[0]!.className).not.toContain("drop-inside");
    fireEvent.drop(cells_of(rows[0]!)[1]!);

    screen.getByText("Write").focus();
    press("ArrowRight", { altKey: true });

    expect(on_move.mock.calls.map(([note, move]) => [note.id, move.lane.id, move.from.id, move.to.id])).toEqual([["b", "left", "open", "done"]]);
  });

  it("puts lanes with no group under the no-group heading, last", () => {
    const lanes: BoardLane[] = [{ id: "loose", label: "Loose" }, { id: "kept", label: "Kept", group: "box" }];
    render(<Board<never, BoardColumn> label="Work" columns={stage_columns} lanes={lanes} labels={{ no_group: "Elsewhere" }} />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["box1", "Elsewhere1"]);
  });

  it("draws lanes with no group as plain rows, at the widths the app gives", () => {
    render(<Board<never, BoardColumn> label="Work" columns={stage_columns} lanes={[{ id: "solo", label: "Solo", head: <b>Solo head</b> }]} column_width="200px" lane_width="20rem" />);

    const grid = screen.getByRole("grid");
    expect(grid.style.getPropertyValue("--board-column-width")).toBe("200px");
    expect(grid.style.getPropertyValue("--board-lane-width")).toBe("20rem");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("rowheader").textContent).toBe("Solo head");
  });
});

// ============================================================================
// States
// ============================================================================

describe("Board states", () => {
  it("shows a skeleton while loading and the failure with Retry", () => {
    const on_retry = vi.fn();
    const { rerender } = render(<Board label="Work" columns={[]} loading />);
    expect(screen.getByLabelText("Loading")).toBeTruthy();

    rerender(<Board label="Work" columns={stage_columns} lanes={[]} error={new Error("offline")} on_retry={on_retry} />);
    expect(screen.getByRole("alert").textContent).toContain("offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(on_retry).toHaveBeenCalledTimes(1);
  });

  it("says it is empty in its own words or shows the app's empty state", () => {
    const { rerender } = render(<Board label="Work" columns={stage_columns} lanes={[]} labels={{ empty: "No work." }} />);
    expect(screen.getByText("No work.")).toBeTruthy();

    rerender(<Board label="Work" columns={stage_columns} lanes={[]} empty={<p>Add some work</p>} />);
    expect(screen.getByText("Add some work")).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
  });
});

// ============================================================================
// Phones
// ============================================================================

describe("Board on a phone", () => {
  function as_phone(run: () => void): void {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      run();
    } finally {
      window.matchMedia = before;
    }
  }

  async function as_phone_while(run: () => Promise<void>): Promise<void> {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      await run();
    } finally {
      window.matchMedia = before;
    }
  }

  const phone_column = (name: string) => screen.getByRole("region", { name });

  it("lists each lane with its filled cells under their column names", () => {
    as_phone(() => {
      render(
        <Board<never, BoardColumn>
          label="Work"
          columns={stage_columns}
          lanes={work}
          render_cell={(lane, column) => (column.id === "plan" ? `${lane!.label} planned` : null)}
        />,
      );

      expect(screen.queryByRole("grid")).toBeNull();
      const lane = screen.getByRole("region", { name: "Third" });
      const cells = lane.querySelectorAll(".board-phone-cell");
      expect([...cells].map((cell) => cell.textContent)).toEqual(["PlanThird planned", "Check"]);
      expect(cells[1]!.getAttribute("aria-current")).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: /north/ }));
      expect(screen.queryByRole("region", { name: "Third" })).toBeNull();
    });
  });

  it("stacks the columns of a plain board, its cards opening on Enter", () => {
    as_phone(() => {
      const on_open = vi.fn();
      render(<Kanban on_open={on_open} />);

      expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["To do2", "Late0", "Done1"]);
      const card = screen.getByText("Ship");
      expect(card.tabIndex).toBe(0);
      expect(card.draggable).toBe(true);
      fireEvent.keyDown(card, { key: "Enter" });
      fireEvent.keyDown(card, { key: "Enter", altKey: true });
      fireEvent.keyDown(card, { key: "a" });
      expect(on_open).toHaveBeenCalledTimes(1);
    });
  });

  it("moves a stacked column's card with Alt and the arrows, past columns that refuse it, and keeps it focused", () => {
    as_phone(() => {
      const on_move = vi.fn();
      render(<Kanban on_move={on_move} />);

      screen.getByText("Read").focus();
      press("ArrowDown", { altKey: true });
      expect(within(phone_column("Done")).getByText("Read")).toBe(document.activeElement);
      press("ArrowDown", { altKey: true });
      press("ArrowUp", { altKey: true });
      expect(within(phone_column("To do")).getByText("Read")).toBe(document.activeElement);
      press("ArrowRight", { altKey: true });
      press("ArrowLeft", { altKey: true });
      press("ArrowLeft", { altKey: true });
      press("ArrowDown");

      expect(on_move.mock.calls.map(([note, move]) => [note.id, move.from.id, move.to.id])).toEqual([
        ["b", "open", "done"], ["b", "done", "open"], ["b", "open", "done"], ["b", "done", "open"],
      ]);
      expect(focused_text()).toBe("Read");
    });
  });

  it("leaves a stacked card's keys alone when the board moves nothing", () => {
    as_phone(() => {
      render(<Board<Note, BoardColumn> label="Notes" columns={kanban_columns} cards={{ of: () => [notes[0]!], id: (note) => note.id, render: (note) => note.title }} />);

      const card = screen.getAllByText("Write")[0]!;
      card.focus();
      press("ArrowDown", { altKey: true });
      expect(card.draggable).toBe(false);
      expect(document.activeElement).toBe(card);
    });
  });

  it("drags a stacked column's card onto a column that takes it, showing a hidden empty one while it is dragged", () => as_phone_while(async () => {
    const on_move = vi.fn();
    const started = vi.fn();
    const ended = vi.fn();
    render(
      <Board<Note, BoardColumn>
        label="Notes"
        columns={kanban_columns}
        phone_hide_empty
        cards={{ of: (_lane, column) => (column.id === "open" ? [notes[0]!] : []), id: (note) => note.id, render: (note) => note.title, on_drag_start: started, on_drag_end: ended }}
        on_move={on_move}
      />,
    );
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["To do"]);
    const card = screen.getByText("Write");

    await start_drag(card);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["To do", "Done"]);
    fireEvent.dragOver(phone_column("To do"));
    expect(phone_column("To do").className).not.toContain("drop-inside");
    fireEvent.dragOver(phone_column("Done"));
    expect(phone_column("Done").className).toContain("drop-inside");
    expect(card.className).toContain("dragging");
    fireEvent.drop(phone_column("Done"));
    fireEvent.dragEnd(card);

    expect(on_move.mock.calls.map(([note, move]) => [note.id, move.lane, move.from.id, move.to.id])).toEqual([["a", null, "open", "done"]]);
    expect(started.mock.calls[0]![0].id).toBe("a");
    expect(ended).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["To do"]);
  }));

  it("drags a lane's card onto that lane's cells the app allows, and moves it with Alt and the arrows", () => as_phone_while(async () => {
    const on_move = vi.fn();
    const can_move = (note: Note, move: BoardMove<BoardColumn, BoardLane>) => !(note.id === "b" && move.to.id === "done");
    render(
      <Board<Note, BoardColumn>
        label="Work"
        columns={kanban_columns}
        lanes={[{ id: "left", label: "Left" }, { id: "right", label: "Right" }]}
        cards={{ of: (lane, column) => notes.filter((note) => note.column === column.id && (lane!.id === "left") === (note.id !== "c")), id: (note) => note.id, render: (note) => note.title }}
        on_move={on_move}
        can_move={can_move}
      />,
    );
    const cells_of = (lane: string) => [...phone_column(lane).querySelectorAll<HTMLElement>(".board-phone-cell")];
    expect(cells_of("Left").map((cell) => cell.textContent)).toEqual(["To doWriteRead"]);

    await start_drag(screen.getByText("Read"));
    expect(cells_of("Left").map((cell) => cell.textContent)).toEqual(["To doWriteRead"]);
    fireEvent.dragOver(cells_of("Right")[0]!);
    fireEvent.drop(cells_of("Right")[0]!);

    await start_drag(screen.getByText("Write"));
    expect(cells_of("Left").map((cell) => cell.textContent)).toEqual(["To doWriteRead", "Done"]);
    const done = cells_of("Left")[1]!;
    fireEvent.dragOver(done);
    expect(done.className).toContain("drop-inside");
    fireEvent.drop(done);

    screen.getByText("Write").focus();
    press("ArrowRight", { altKey: true });
    screen.getByText("Read").focus();
    press("ArrowDown", { altKey: true });

    expect(on_move.mock.calls.map(([note, move]) => [note.id, move.lane.id, move.from.id, move.to.id])).toEqual([["a", "left", "open", "done"], ["a", "left", "open", "done"]]);
  }));

  it("leaves out a plain board's empty columns when asked, and takes the app's class", () => {
    as_phone(() => {
      const board = (phone_hide_empty: boolean) => (
        <Board<Note, BoardColumn>
          label="Notes"
          columns={kanban_columns}
          phone_hide_empty={phone_hide_empty}
          class_name="fills"
          cards={{ of: (_lane, column) => notes.filter((note) => note.column === column.id), id: (note) => note.id, render: (note) => note.title }}
        />
      );
      const { rerender } = render(board(false));
      expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["To do", "Late", "Done"]);
      expect(screen.getByRole("region", { name: "Notes" }).className).toBe("board-phone fills");

      rerender(board(true));
      expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["To do", "Done"]);
    });
  });

  it("puts the app's class on the grid's box off a phone", () => {
    const { container } = render(<Board<never, BoardColumn> label="Work" columns={stage_columns} class_name="fills" render_cell={() => null} />);
    expect(container.firstElementChild!.className).toBe("board fills");
  });

  it("leaves out empty columns drawn by render_cell too", () => {
    as_phone(() => {
      render(<Board<never, BoardColumn> label="Work" columns={stage_columns} phone_hide_empty render_cell={(_lane, column) => (column.id === "build" ? "Building" : "")} />);
      expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Build"]);
    });
  });

  it("lists cards in a lane's cells", () => {
    as_phone(() => {
      render(
        <Board<Note, BoardColumn>
          label="Work"
          columns={kanban_columns}
          lanes={[{ id: "only", label: "Only" }]}
          cards={{ of: (_lane, column) => notes.filter((note) => note.column === column.id), id: (note) => note.id, render: (note) => note.title }}
        />,
      );

      const cells = screen.getByRole("region", { name: "Only" }).querySelectorAll(".board-phone-cell");
      expect([...cells].map((cell) => cell.textContent)).toEqual(["To doWriteRead", "DoneShip"]);
    });
  });
});

describe("use_phone", () => {
  it("follows the window across the phone width", () => {
    const before = window.matchMedia;
    const listeners: (() => void)[] = [];
    const list = { matches: false, addEventListener: (_type: string, listener: () => void) => listeners.push(listener), removeEventListener: vi.fn() };
    window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
    let seen = false;
    function Probe() {
      seen = use_phone();
      return null;
    }
    try {
      const { unmount } = render(<Probe />);
      expect(seen).toBe(false);

      list.matches = true;
      act(() => listeners.forEach((listener) => listener()));
      expect(seen).toBe(true);

      unmount();
      expect(list.removeEventListener).toHaveBeenCalled();
    } finally {
      window.matchMedia = before;
    }
  });
});
