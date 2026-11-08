// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ColorPicker, CommitInput, DateTimeField, PathInput, SearchBox, Select, TreeSelect } from "../src/web/react/controls.tsx";
import type { TreeItem } from "../src/web/tree.ts";

afterEach(cleanup);

// ============================================================================
// Search box
// ============================================================================

describe("SearchBox", () => {
  test("hands on the text once typing pauses, and shows a value cleared from outside", () => {
    vi.useFakeTimers();
    const on_input = vi.fn();
    const { rerender } = render(<SearchBox label="Search" value="" on_input={on_input} auto_focus />);
    const field = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" });

    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "milk" } });
    expect(on_input).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(on_input).toHaveBeenCalledWith("milk");

    rerender(<SearchBox label="Search" value="milk" on_input={on_input} />);
    expect(field.value).toBe("milk");
    rerender(<SearchBox label="Search" value="" on_input={on_input} />);
    expect(field.value).toBe("");
    vi.useRealTimers();
  });

  test("drops typing not yet handed on when the value is cleared from outside", () => {
    vi.useFakeTimers();
    const on_input = vi.fn();
    const { rerender } = render(<SearchBox label="Search" value="milk" on_input={on_input} />);
    const field = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" });

    fireEvent.change(field, { target: { value: "milkshake" } });
    rerender(<SearchBox label="Search" value="" on_input={on_input} />);
    vi.advanceTimersByTime(200);

    expect(field.value).toBe("");
    expect(on_input).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("submits on Enter without waiting, and clears on Escape, taking a submitted search back", () => {
    vi.useFakeTimers();
    const on_input = vi.fn();
    const on_submit = vi.fn();
    render(<SearchBox label="Search" value="" on_input={on_input} on_submit={on_submit} />);
    const field = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" });

    fireEvent.change(field, { target: { value: "milk" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(on_input).toHaveBeenCalledWith("milk");
    expect(on_submit).toHaveBeenCalledWith("milk");

    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe("");
    expect(on_input).toHaveBeenLastCalledWith("");
    expect(on_submit).toHaveBeenLastCalledWith("");
    expect(on_submit).toHaveBeenCalledTimes(2);

    fireEvent.change(field, { target: { value: "tea" } });
    fireEvent.change(field, { target: { value: "" } });
    vi.advanceTimersByTime(200);
    expect(on_submit).toHaveBeenCalledTimes(2);
    expect(on_input).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test("with only on_submit, typing hands nothing on until Enter, and an emptied draft submits nothing", () => {
    vi.useFakeTimers();
    const on_submit = vi.fn();
    render(<SearchBox label="Search" value="" on_submit={on_submit} />);
    const field = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" });

    fireEvent.change(field, { target: { value: "milk" } });
    vi.advanceTimersByTime(500);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(on_submit).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "tea" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(on_submit).toHaveBeenCalledWith("tea");
    expect(on_submit).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("shows a submit button as a search form, empties itself after submitting, and lets a paste be taken whole", () => {
    const on_submit = vi.fn();
    const on_paste = vi.fn((text: string) => text.startsWith("https://"));
    render(<SearchBox label="Search" value="" on_submit={on_submit} on_paste={on_paste} submit_label="Search" clear_on_submit />);
    const field = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" });

    expect(screen.getByRole("search")).toBeTruthy();
    fireEvent.change(field, { target: { value: "milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(on_submit).toHaveBeenCalledWith("milk");
    expect(field.value).toBe("");

    fireEvent.paste(field, { clipboardData: { getData: () => "https://example.com/v" } });
    expect(on_paste).toHaveBeenCalledWith("https://example.com/v");
    expect(field.value).toBe("");

    fireEvent.change(field, { target: { value: "" } });
    expect(on_submit).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Select
// ============================================================================

describe("Select", () => {
  test("keeps its labelled field by default", () => {
    render(<Select label="Sort" options={[["name", "Name"], ["date", "Date"]]} value="name" on_change={() => {}} />);

    expect(screen.getByLabelText("Sort").closest(".field")).toBeTruthy();
  });

  test("bare, renders only the select, named by its label, and hands back number values", () => {
    const on_change = vi.fn();
    const { container } = render(<Select bare label="Week starts" options={[[0, "Sunday"], [1, "Monday"]]} value={0} on_change={on_change} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Week starts" }), { target: { value: "1" } });

    expect(container.firstElementChild!.tagName).toBe("SELECT");
    expect(on_change).toHaveBeenCalledWith(1);
  });
});

// ============================================================================
// Fields
// ============================================================================

describe("CommitInput", () => {
  test("saves once left or on Enter, and shows the saved value again", () => {
    const on_commit = vi.fn((event: { currentTarget: HTMLInputElement }) => event.currentTarget.value);
    const { rerender } = render(<CommitInput aria-label="Title" value="Old" on_commit={on_commit} />);
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Title" });

    fireEvent.change(input, { target: { value: "New" } });
    expect(on_commit).not.toHaveBeenCalled();
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(on_commit.mock.results[0]!.value).toBe("New");

    rerender(<CommitInput aria-label="Title" value="Saved" on_commit={on_commit} />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Title" }).value).toBe("Saved");
  });
});

describe("DateTimeField", () => {
  test("shows only the date until a day is set", () => {
    render(<DateTimeField label="Due" value={null} on_change={() => {}} />);

    expect(screen.getByLabelText("Due date")).toBeTruthy();
    expect(screen.queryByLabelText("Due time")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear due date" })).toBeNull();
  });

  test("joins the day and time, and clearing the date clears both", () => {
    const on_change = vi.fn();
    render(<DateTimeField label="Due" value="2026-06-10T09:30" on_change={on_change} />);

    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "10:15" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-06-11" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));

    expect(on_change.mock.calls).toEqual([["2026-06-10T10:15"], ["2026-06-11T09:30"], ["2026-06-10"], [null]]);
  });

  test("has no time when time is not allowed", () => {
    render(<DateTimeField label="Start" value="2026-06-10" allow_time={false} on_change={() => {}} />);

    expect(screen.queryByLabelText("Start time")).toBeNull();
  });
});

// ============================================================================
// Pickers
// ============================================================================

describe("ColorPicker", () => {
  const swatches = ["#e5484d", "#30a46c"];

  test("checks the chosen swatch and picks another or none", () => {
    const on_change = vi.fn();
    render(<ColorPicker label="Colour" value="#30A46C" swatches={swatches} on_change={on_change} />);

    expect(screen.getByRole("radio", { name: "#30a46c" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "No colour" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("Other colour").className).toBe("color-custom");

    fireEvent.click(screen.getByRole("radio", { name: "#e5484d" }));
    fireEvent.click(screen.getByRole("radio", { name: "No colour" }));
    fireEvent.change(screen.getByLabelText("Other colour"), { target: { value: "#123456" } });

    expect(on_change.mock.calls).toEqual([["#e5484d"], [null], ["#123456"]]);
  });

  test("marks the system chooser for any other colour, and can leave out None", () => {
    render(<ColorPicker label="Colour" value="#123456" swatches={swatches} allow_none={false} on_change={() => {}} />);

    expect(screen.getByLabelText<HTMLInputElement>("Other colour").className).toBe("color-custom chosen");
    expect(screen.getByLabelText<HTMLInputElement>("Other colour").value).toBe("#123456");
    expect(screen.queryByRole("radio", { name: "No colour" })).toBeNull();
  });
});

describe("TreeSelect", () => {
  interface Tag extends TreeItem { name: string }
  const tags: Tag[] = [
    { id: "h", parent_id: null, position: 2, name: "Home" },
    { id: "c", parent_id: "w", position: 1, name: "Clients" },
    { id: "w", parent_id: null, position: 1, name: "Work" },
  ];

  test("lists the tree indented with each path on hover, greying disabled ones", () => {
    const on_change = vi.fn();
    render(<TreeSelect label="Parent" items={tags} name_of={(tag) => tag.name} value="c" blank_label="No parent" disabled_ids={["w"]} on_change={on_change} />);
    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Parent" });
    const options = [...select.options];

    expect(options.map((option) => option.textContent)).toEqual(["No parent", "Work", " Clients", "Home"]);
    expect(options[2]!.title).toBe("Work › Clients");
    expect(options[1]!.disabled).toBe(true);
    expect(select.value).toBe("c");
    expect(select.title).toBe("Work › Clients");

    fireEvent.change(select, { target: { value: "" } });
    expect(on_change).toHaveBeenCalledWith("");
  });
});

// ============================================================================
// Path input
// ============================================================================

describe("PathInput", () => {
  test("typing changes the path, and Browse takes what the picker chooses but not a cancel", async () => {
    const on_change = vi.fn();
    const pick = vi.fn<(current: string) => Promise<string | null>>().mockResolvedValueOnce("/music").mockResolvedValueOnce(null);
    render(<PathInput label="Music folder" value="/home" on_change={on_change} pick={pick} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Music folder" }), { target: { value: "/tmp" } });
    expect(on_change).toHaveBeenLastCalledWith("/tmp");

    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await screen.findByRole("button", { name: "Browse…" });
    await Promise.resolve();
    expect(pick).toHaveBeenCalledWith("/home");
    expect(on_change).toHaveBeenLastCalledWith("/music");

    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await Promise.resolve();
    expect(on_change).toHaveBeenCalledTimes(2);
  });
});
