// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { moved, RowActions, Section, SelectionBar, SettingRow, SettingsGroup } from "../src/web/react/layout.tsx";

afterEach(cleanup);

describe("panels and settings", () => {
  test("a section takes a class and a context menu", () => {
    const on_context_menu = vi.fn();
    render(<Section title="Tags" class_name="tag-panel" on_context_menu={on_context_menu}>Body</Section>);
    const panel = screen.getByText("Body").closest("section")!;

    fireEvent.contextMenu(panel);

    expect(panel.className).toBe("panel tag-panel");
    expect(on_context_menu).toHaveBeenCalled();
  });

  test("a settings group takes any heading, and a row a class", () => {
    render(<SettingsGroup heading={<em>Views</em>}><SettingRow label="Order" class_name="list-row">x</SettingRow></SettingsGroup>);

    expect(screen.getByRole("heading").innerHTML).toBe("<em>Views</em>");
    expect(screen.getByText("Order").closest(".setting-row")!.className).toBe("setting-row list-row");
  });
});

describe("row actions", () => {
  test("moves an item along and removes it, the ends' buttons disabled", () => {
    const on_move = vi.fn();
    const on_remove = vi.fn();
    render(<RowActions index={0} count={2} on_move={on_move} on_remove={on_remove} remove_label="Remove Weekly" />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Move up" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Weekly" }));

    expect(on_move).toHaveBeenCalledWith(0, 1);
    expect(on_remove).toHaveBeenCalled();
  });

  test("has no remove button without on_remove", () => {
    render(<RowActions index={1} count={2} on_move={() => {}} remove_label="Remove Weekly" />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Move down" }).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Remove Weekly" })).toBeNull();
  });

  test("moved moves one item to a new index", () => {
    expect(moved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b", "c"], 5, 0)).toEqual(["a", "b", "c"]);
  });
});

describe("SelectionBar", () => {
  test("says how many are picked, offers Select all while some are left, and clears", () => {
    const on_clear = vi.fn();
    const on_select_all = vi.fn();
    const { rerender } = render(<SelectionBar count={2} total={5} on_clear={on_clear} on_select_all={on_select_all}><button>Delete</button></SelectionBar>);

    expect(screen.getByRole("toolbar", { name: "Selected rows" }).textContent).toContain("2 selected");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(on_select_all).toHaveBeenCalledOnce();
    expect(on_clear).toHaveBeenCalledOnce();

    rerender(<SelectionBar count={5} total={5} on_clear={on_clear} on_select_all={on_select_all}><button>Delete</button></SelectionBar>);
    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
  });
});
