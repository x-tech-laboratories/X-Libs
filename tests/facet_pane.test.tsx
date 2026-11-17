// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FacetPane, facet_pick, type FacetValue } from "../src/web/react/facet_pane.tsx";

afterEach(cleanup);

const genres: FacetValue[] = [
  { value: "Blues", count: 3 },
  { value: "Jazz", count: 5 },
  { value: "Rock", count: 2 },
  { value: "Soul", count: 1 },
];

// A pane that keeps its own picks, as an app would.
function Picking({ values = genres, multiple, virtual, on_change }: { values?: FacetValue[]; multiple?: boolean; virtual?: { row_height: number }; on_change?: (selected: string[]) => void }) {
  const [selected, set_selected] = useState<string[]>([]);
  const change = (next: string[]) => {
    set_selected(next);
    on_change?.(next);
  };
  return <FacetPane label="Genre" values={values} selected={selected} on_change={change} multiple={multiple} virtual={virtual} />;
}

const picked_names = () => screen.getAllByRole("option").filter((option) => option.getAttribute("aria-selected") === "true").map((option) => option.textContent);

// ============================================================================
// Picking rules
// ============================================================================

describe("facet_pick", () => {
  const order = ["Blues", "Jazz", "Rock", "Soul"];

  it("replaces on a plain pick and clears when the only pick is picked again", () => {
    expect(facet_pick(order, ["Blues"], null, "Rock", { shift: false, ctrl: false })).toEqual(["Rock"]);
    expect(facet_pick(order, ["Rock"], "Rock", "Rock", { shift: false, ctrl: false })).toEqual([]);
  });

  it("toggles with Ctrl and keeps the shown order", () => {
    expect(facet_pick(order, ["Soul"], "Soul", "Blues", { shift: false, ctrl: true })).toEqual(["Blues", "Soul"]);
    expect(facet_pick(order, ["Blues", "Soul"], "Soul", "Soul", { shift: false, ctrl: true })).toEqual(["Blues"]);
  });

  it("ranges from the anchor with Shift, adding to the picks with Ctrl+Shift", () => {
    expect(facet_pick(order, ["Soul"], "Jazz", "Soul", { shift: true, ctrl: false })).toEqual(["Jazz", "Rock", "Soul"]);
    expect(facet_pick(order, ["Blues"], "Rock", "Soul", { shift: true, ctrl: true })).toEqual(["Blues", "Rock", "Soul"]);
  });

  it("picks one value at a time when not multiple", () => {
    expect(facet_pick(order, ["Blues"], "Blues", "Soul", { shift: true, ctrl: true }, false)).toEqual(["Soul"]);
  });
});

// ============================================================================
// Pane
// ============================================================================

describe("facet pane", () => {
  it("lists All and each value with its count in a labelled listbox", () => {
    render(<Picking />);

    const list = screen.getByRole("listbox", { name: "Genre" });
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["All11", "Blues3", "Jazz5", "Rock2", "Soul1"]);
    expect(picked_names()).toEqual(["All11"]);
    expect(screen.getByText("4 values")).toBeTruthy();
  });

  it("picks by plain, Ctrl and Shift clicks, and All clears", () => {
    const on_change = vi.fn();
    render(<Picking on_change={on_change} />);

    fireEvent.click(screen.getByRole("option", { name: /Jazz/ }));
    expect(picked_names()).toEqual(["Jazz5"]);
    fireEvent.click(screen.getByRole("option", { name: /Soul/ }), { ctrlKey: true });
    expect(picked_names()).toEqual(["Jazz5", "Soul1"]);
    expect(screen.getByText("2 of 4 picked")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Blues/ }), { shiftKey: true });
    expect(picked_names()).toEqual(["Blues3", "Jazz5", "Rock2", "Soul1"]);
    fireEvent.click(screen.getByRole("option", { name: /All/ }));

    expect(picked_names()).toEqual(["All11"]);
    expect(on_change).toHaveBeenLastCalledWith([]);
  });

  it("walks with the arrow keys, picks with Space, stretches with Shift and clears with Escape", () => {
    render(<Picking />);
    const list = screen.getByRole("listbox");
    const all = screen.getByRole("option", { name: /All/ });
    expect(all.tabIndex).toBe(0);
    all.focus();

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /Blues/ }));
    fireEvent.keyDown(list, { key: " " });
    expect(picked_names()).toEqual(["Blues3"]);
    fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /Rock/ }));
    expect(picked_names()).toEqual(["Blues3", "Jazz5", "Rock2"]);
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    expect(picked_names()).toEqual(["Blues3", "Jazz5", "Rock2", "Soul1"]);
    fireEvent.keyDown(list, { key: "Escape" });

    expect(picked_names()).toEqual(["All11"]);
    fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    expect(picked_names()).toEqual(["Blues3", "Jazz5", "Rock2", "Soul1"]);
  });

  it("keeps one pick at a time when not multiple", () => {
    render(<Picking multiple={false} />);

    fireEvent.click(screen.getByRole("option", { name: /Jazz/ }));
    fireEvent.click(screen.getByRole("option", { name: /Rock/ }), { ctrlKey: true });

    expect(picked_names()).toEqual(["Rock2"]);
    expect(screen.getByRole("listbox").getAttribute("aria-multiselectable")).toBeNull();
  });

  it("shows loading, failure with Retry, and no values", () => {
    const retry = vi.fn();
    const { rerender } = render(<FacetPane label="Genre" values={[]} selected={[]} on_change={() => {}} loading />);
    expect(screen.getByLabelText("Loading")).toBeTruthy();

    rerender(<FacetPane label="Genre" values={[]} selected={[]} on_change={() => {}} error={new Error("database locked")} on_retry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("database locked");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();

    rerender(<FacetPane label="Genre" values={[]} selected={[]} on_change={() => {}} />);
    expect(screen.getByText("No values")).toBeTruthy();
  });

  it("draws only the rows in view of a long list and still reaches the last by End", () => {
    const artists = Array.from({ length: 2000 }, (_, index) => ({ value: `Artist ${index}`, count: 1 }));
    render(<Picking values={artists} virtual={{ row_height: 28 }} />);

    expect(screen.getAllByRole("option").length).toBeLessThan(100);
    const list = screen.getByRole("listbox");
    screen.getByRole("option", { name: /All/ }).focus();
    fireEvent.keyDown(list, { key: "End" });

    expect(document.activeElement?.textContent).toBe("Artist 19991");
    expect(document.activeElement?.getAttribute("aria-posinset")).toBe("2001");
  });
});
