// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { item_after_key, item_starting_with, type MenuItem } from "../src/web/menus.ts";
import { ContextMenu, ContextMenus, MenuList, Popover, open_context_menu } from "../src/web/react/menus.tsx";

afterEach(cleanup);

// ============================================================================
// Menu
// ============================================================================

function items(run = vi.fn()): MenuItem[] {
  return [
    { label: "Open", run },
    { label: "Copy link", run },
    { label: "Delete", run, disabled: true, danger: true },
    { label: "Duplicate", run },
    { label: "Rename", run },
  ];
}

// A button that opens the menu, so focus has somewhere to go back to.
function MenuOpener({ menu_items }: { menu_items: MenuItem[] }) {
  const [open, set_open] = useState(false);
  return (
    <>
      <button onClick={() => set_open(true)}>Actions</button>
      {open && <ContextMenu x={10} y={10} items={menu_items} on_close={() => set_open(false)} />}
    </>
  );
}

function open_menu(menu_items = items()): HTMLElement {
  render(<MenuOpener menu_items={menu_items} />);
  const opener = screen.getByRole("button", { name: "Actions" });
  opener.focus();
  fireEvent.click(opener);
  return screen.getByRole("menu");
}

const focused = () => document.activeElement?.textContent;

describe("context menu keys", () => {
  it("moves with the arrows, wrapping round, and jumps with Home and End past disabled items", () => {
    const menu = open_menu();

    expect(focused()).toBe("Open");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(focused()).toBe("Rename");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Open");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Duplicate");
    fireEvent.keyDown(menu, { key: "End" });
    expect(focused()).toBe("Rename");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(focused()).toBe("Open");
  });

  it("jumps to an item by its first letters", () => {
    const menu = open_menu();
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    fireEvent.keyDown(menu, { key: "c" });
    fireEvent.keyDown(menu, { key: "o" });
    expect(focused()).toBe("Copy link");
    now = 1000;
    fireEvent.keyDown(menu, { key: "d" });
    expect(focused()).toBe("Duplicate");
    now = 2000;
    fireEvent.keyDown(menu, { key: "r" });
    expect(focused()).toBe("Rename");
    vi.restoreAllMocks();
  });

  it("runs the item on Enter and closes", () => {
    const run = vi.fn();
    const menu = open_menu(items(run));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe("Actions");
  });

  it("closes on Escape and gives focus back to the opener", () => {
    const menu = open_menu();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe("Actions");
  });

  it("marks disabled, ticked and danger items for assistive technology", () => {
    render(<ContextMenu x={0} y={0} on_close={() => {}} items={[...items(), { label: "Pinned", run: () => {}, checked: true }, { label: "Any", run: () => {}, checked: false, radio: true }]} />);

    expect(screen.getByRole("menuitem", { name: "Delete" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toContain("danger");
    expect(screen.getByRole("menuitemcheckbox", { name: "Pinned" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Any" }).getAttribute("aria-checked")).toBe("false");
  });

  it("does not run a disabled item and stays open after an item that keeps it open", () => {
    const run = vi.fn();
    const on_close = vi.fn();
    render(<ContextMenu x={0} y={0} on_close={on_close} items={[{ label: "Off", run, disabled: true }, { label: "Show notes", run, checked: false, keep_open: true }]} />);

    fireEvent.click(screen.getByRole("menuitem", { name: "Off" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show notes" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(on_close).not.toHaveBeenCalled();
  });

  it("ticks items that keep it open at once, even when the items never change", () => {
    const run = vi.fn();
    const menu_items: MenuItem[] = [
      { label: "Show notes", run, checked: false, keep_open: true },
      { label: "By name", run, checked: true, radio: true, keep_open: true, separator_before: true },
      { label: "By date", run, checked: false, radio: true, keep_open: true },
    ];
    render(<ContextMenu x={0} y={0} on_close={() => {}} items={menu_items} />);
    const checked = (role: "menuitemcheckbox" | "menuitemradio", name: string) => screen.getByRole(role, { name }).getAttribute("aria-checked");

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show notes" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "By date" }));

    expect(checked("menuitemcheckbox", "Show notes")).toBe("true");
    expect(checked("menuitemradio", "By name")).toBe("false");
    expect(checked("menuitemradio", "By date")).toBe("true");
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes on a press outside it, not on one inside it nor on the release that opened it", () => {
    const on_close = vi.fn();
    render(<ContextMenu x={0} y={0} on_close={on_close} items={items()} />);
    const menu = screen.getByRole("menu");
    vi.spyOn(menu, "matches").mockReturnValue(true);

    fireEvent.pointerUp(document.body);
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Open" }));
    expect(on_close).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(on_close).toHaveBeenCalledOnce();
  });

  it("opens from anywhere at the event's point", () => {
    render(<ContextMenus />);

    act(() => open_context_menu({ clientX: 5, clientY: 6, preventDefault: () => {} }, items()));

    expect(screen.getByRole("menu").style.left).toBe("5px");
  });
});

describe("menu key helpers", () => {
  it("wraps arrows round and starts from the ends when nothing is focused", () => {
    expect(item_after_key("ArrowDown", 2, 3)).toBe(0);
    expect(item_after_key("ArrowUp", 0, 3)).toBe(2);
    expect(item_after_key("ArrowUp", -1, 3)).toBe(2);
    expect(item_after_key("x", 0, 3)).toBeNull();
  });

  it("steps through items sharing a first letter and matches longer typing", () => {
    const labels = ["Copy", "Cut", "Clear", "Paste"];

    expect(item_starting_with(labels, "c", 0)).toBe(1);
    expect(item_starting_with(labels, "cc", 1)).toBe(2);
    expect(item_starting_with(labels, "cl", 0)).toBe(2);
    expect(item_starting_with(labels, "z", 0)).toBeNull();
  });
});

// ============================================================================
// Popover
// ============================================================================

describe("popover keys", () => {
  it("moves between its menu items with the arrows and closes on Escape", () => {
    const on_close = vi.fn();
    render(
      <Popover label="Filter" on_close={on_close}>
        <MenuList on_close={on_close} items={[{ label: "Any", run: () => {} }, { label: "Today", run: () => {} }]} />
      </Popover>,
    );
    const popover = document.querySelector<HTMLElement>('[role="dialog"]')!;

    expect(focused()).toBe("Any");
    fireEvent.keyDown(popover, { key: "ArrowDown" });
    expect(focused()).toBe("Today");
    fireEvent.keyDown(popover, { key: "Escape" });
    expect(on_close).toHaveBeenCalled();
  });
});
