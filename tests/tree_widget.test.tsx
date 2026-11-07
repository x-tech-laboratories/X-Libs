// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { Tree, type TreeMove } from "../src/web/react/tree.tsx";
import type { TreeItem } from "../src/web/tree.ts";

interface Row extends TreeItem {
  name: string;
}

const rows: Row[] = [
  { id: "a", parent_id: null, position: 1, name: "Work" },
  { id: "b", parent_id: "a", position: 1, name: "Clients" },
  { id: "c", parent_id: "a", position: 2, name: "Office" },
  { id: "e", parent_id: null, position: 2, name: "Home" },
];

// Holds the folded rows itself, as an app would.
function Harness({ on_move = () => {}, new_item = null }: { on_move?: (row: Row, move: TreeMove) => void; new_item?: { parent_id: string | null; form: React.ReactNode } | null }) {
  const [collapsed, set_collapsed] = useState<Set<string>>(new Set());
  return (
    <Tree
      items={rows}
      label="Tags"
      render_item={(row) => row.name}
      render_extra={(row) => <span className="badge">{row.name.length}</span>}
      name_of={(row) => row.name}
      collapsed={collapsed}
      on_collapsed_change={set_collapsed}
      on_select={() => {}}
      on_move={on_move}
      new_item={new_item}
    />
  );
}

const item_named = (name: string) => screen.getByText(name).closest<HTMLElement>("[role=treeitem]")!;
const row_named = (name: string) => item_named(name).querySelector<HTMLElement>(".tree-row")!;

// jsdom has no drag events or layout, so the drag carries its own clientY and each row a fixed 40px box.
function drag(element: HTMLElement, type: "dragStart" | "dragOver" | "drop", client_y = 0): void {
  const event = createEvent[type](element);
  Object.defineProperty(event, "clientY", { value: client_y });
  fireEvent(element, event);
}

function give_rows_a_box(): void {
  for (const row of document.querySelectorAll<HTMLElement>(".tree-row")) row.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) });
}

afterEach(cleanup);

// ── Folding ──────────────────────────────────────────────────────────────────

describe("folding", () => {
  test("nests rows with their extras, and folds them away with the button", () => {
    render(<Harness />);

    expect(screen.getByRole("tree", { name: "Tags" })).toBeTruthy();
    expect(item_named("Clients").getAttribute("aria-level")).toBe("2");
    expect(row_named("Clients").querySelector(".tree-extra")!.textContent).toBe("7");

    fireEvent.click(screen.getByRole("button", { name: "Collapse Work" }));

    expect(screen.queryByText("Clients")).toBeNull();
    expect(item_named("Work").getAttribute("aria-expanded")).toBe("false");
  });

  test("walks and folds with the arrow keys", () => {
    render(<Harness />);
    const work = item_named("Work");
    work.focus();

    fireEvent.keyDown(work, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item_named("Clients"));

    fireEvent.keyDown(item_named("Clients"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(work);

    fireEvent.keyDown(work, { key: "ArrowLeft" });
    expect(screen.queryByText("Clients")).toBeNull();

    fireEvent.keyDown(work, { key: "End" });
    expect(document.activeElement).toBe(item_named("Home"));

    fireEvent.keyDown(item_named("Home"), { key: "Home" });
    fireEvent.keyDown(work, { key: "ArrowRight" });
    expect(screen.getByText("Clients")).toBeTruthy();
  });

  test("shows the new item form among the children of its parent", () => {
    render(<Harness new_item={{ parent_id: "a", form: <input aria-label="New tag" /> }} />);

    expect(item_named("Work").querySelector(".tree-children .tree-new input")).toBe(screen.getByRole("textbox", { name: "New tag" }));
  });
});

// ── Moving ───────────────────────────────────────────────────────────────────

describe("moving", () => {
  test("drops before, inside or after a row by where the pointer is", () => {
    const on_move = vi.fn();
    render(<Harness on_move={on_move} />);
    give_rows_a_box();

    drag(row_named("Home"), "dragStart");
    drag(row_named("Office"), "dragOver", 105);
    expect(row_named("Office").className).toContain("drop-before");
    drag(row_named("Office"), "drop", 105);

    drag(row_named("Home"), "dragStart");
    drag(row_named("Clients"), "dragOver", 120);
    expect(row_named("Clients").className).toContain("drop-inside");
    drag(row_named("Clients"), "drop", 120);

    expect(on_move.mock.calls.map(([row, move]) => [row.id, move])).toEqual([
      ["e", { parent_id: "a", position: 1.5 }],
      ["e", { parent_id: "b", position: 2 }],
    ]);
  });

  test("refuses a drop into the dragged row's own subtree", () => {
    const on_move = vi.fn();
    render(<Harness on_move={on_move} />);
    give_rows_a_box();

    drag(row_named("Work"), "dragStart");
    drag(row_named("Clients"), "dragOver", 120);
    drag(row_named("Clients"), "drop", 120);

    expect(row_named("Clients").className).not.toContain("drop-");
    expect(on_move).not.toHaveBeenCalled();
  });

  test("moves with Alt and the arrow keys", () => {
    const on_move = vi.fn();
    render(<Harness on_move={on_move} />);

    fireEvent.keyDown(item_named("Office"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(item_named("Office"), { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(item_named("Clients"), { key: "ArrowLeft", altKey: true });

    expect(on_move.mock.calls.map(([row, move]) => [row.id, move])).toEqual([
      ["c", { parent_id: "a", position: 0 }],
      ["c", { parent_id: "b", position: 2 }],
      ["b", { parent_id: null, position: 1.5 }],
    ]);
  });
});

// ── Picking, classes and outside drops ───────────────────────────────────────

describe("picking and outside drops", () => {
  test("shows several rows selected, the first being the tab stop, and opens a row on double-click", () => {
    const on_activate = vi.fn();
    render(
      <Tree items={rows} label="Tags" render_item={(row) => row.name} collapsed={new Set()} on_collapsed_change={() => {}}
        selected_ids={new Set(["c", "e"])} on_activate={on_activate} row_class={(row) => row.parent_id === null ? "group-heading" : undefined} />,
    );

    expect(screen.getByRole("tree").getAttribute("aria-multiselectable")).toBe("true");
    expect(screen.getAllByRole("treeitem").filter((item) => item.getAttribute("aria-selected") === "true").map((item) => item.dataset.id)).toEqual(["c", "e"]);
    expect(item_named("Office").tabIndex).toBe(0);
    expect(row_named("Work").className).toContain("group-heading");
    expect(row_named("Clients").className).not.toContain("group-heading");

    fireEvent.doubleClick(row_named("Home"));
    expect(on_activate).toHaveBeenCalledWith(rows[3]);
  });

  test("takes a drop from outside on a row that accepts it", () => {
    const on_external_drop = vi.fn();
    render(
      <Tree items={rows} label="Tags" render_item={(row) => row.name} collapsed={new Set()} on_collapsed_change={() => {}}
        accepts_external={(_event, row) => row.id !== "e"} on_external_drop={(_event, row) => on_external_drop(row.id)} />,
    );

    drag(row_named("Home"), "dragOver");
    expect(row_named("Home").className).not.toContain("drop-");
    drag(row_named("Office"), "dragOver");
    expect(row_named("Office").className).toContain("drop-inside");
    drag(row_named("Office"), "drop");

    expect(on_external_drop).toHaveBeenCalledWith("c");
    expect(row_named("Office").className).not.toContain("drop-");
  });
});
