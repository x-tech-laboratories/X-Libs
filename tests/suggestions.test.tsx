// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useState } from "react";

import { ComboField, Suggestions } from "../src/web/react/suggestions.tsx";

afterEach(cleanup);

interface Command { name: string; usage: string; description: string }

const commands: Command[] = [
  { name: "answer", usage: "/answer request", description: "Answer mode" },
  { name: "draft", usage: "/draft request", description: "Draft mode" },
  { name: "do", usage: "/do request", description: "Execute mode" },
];

// Completions for the first word of the text, as slash commands are.
const source = (value: string): Command[] => value.startsWith("/") && !/\s/.test(value) ? commands.filter((command) => command.name.startsWith(value.slice(1))) : [];

function Box({ on_take, on_key_down }: { on_take: (command: Command) => void; on_key_down?: () => void }) {
  return (
    <Suggestions<Command, HTMLTextAreaElement> value="/d" source={source} key_of={(command) => command.name} render={(command) => command.usage} detail={(command) => command.description} on_take={on_take} label="Commands" on_key_down={on_key_down}>
      {(field) => <textarea aria-label="Your request" defaultValue="/d" {...field} />}
    </Suggestions>
  );
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

test("lists what the text could become, arrows pick one, and Tab takes it", async () => {
  const on_take = vi.fn();
  render(<Box on_take={on_take} />);
  await settle();

  const field = screen.getByRole("textbox", { name: "Your request" });
  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["/draft requestDraft mode", "/do requestExecute mode"]);
  expect(options[0]!.getAttribute("aria-selected")).toBe("true");
  expect(field.getAttribute("aria-activedescendant")).toBe(options[0]!.id);

  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(field, { key: "Tab" });

  expect(on_take).toHaveBeenCalledWith(commands[2]);
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("Escape dismisses the list, a click takes one, and other keys pass through", async () => {
  const on_take = vi.fn();
  const on_key_down = vi.fn();
  render(<Box on_take={on_take} on_key_down={on_key_down} />);
  await settle();
  const field = screen.getByRole("textbox", { name: "Your request" });

  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  expect(on_key_down).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(screen.getByRole("option", { name: /draft/ }));
  expect(on_take).toHaveBeenCalledWith(commands[1]);

  expect(screen.queryByRole("listbox")).toBeNull();
});

// ════════════════════════════════════════════════════════════════════════════
// Combo field
// ════════════════════════════════════════════════════════════════════════════

const meals = ["Breakfast", "Lunch", "Dinner", "Snack"];

function Meal({ on_enter, on_take, list_on_focus, initial = "" }: { on_enter?: (value: string) => void; on_take?: (value: string) => void; list_on_focus?: boolean; initial?: string }) {
  const [value, set_value] = useState(initial);
  return (
    <>
      <ComboField label="Meal" value={value} options={meals} on_change={set_value} on_take={on_take} on_enter={on_enter && (() => on_enter(value))} list_on_focus={list_on_focus} />
      <output>{value}</output>
    </>
  );
}

function names(): string[] {
  return screen.queryAllByRole("option").map((option) => option.textContent ?? "");
}

test("a combo field lists every value once entered, nothing lit, and narrows as it is typed into", async () => {
  render(<Meal />);
  await settle();
  const field = screen.getByRole("combobox", { name: "Meal" });
  expect(screen.queryByRole("listbox")).toBeNull();

  fireEvent.focus(field);
  expect(names()).toEqual(meals);
  expect(field.getAttribute("aria-expanded")).toBe("true");
  expect(field.getAttribute("aria-activedescendant")).toBeNull();

  fireEvent.input(field, { target: { value: "NN" } });
  fireEvent.change(field, { target: { value: "NN" } });
  await settle();
  expect(names()).toEqual(["Dinner"]);
});

test("a combo field takes a value by arrow and Enter, comes back to the text past the end, and closes on Escape", async () => {
  const on_enter = vi.fn();
  render(<Meal on_enter={on_enter} />);
  await settle();
  const field = screen.getByRole("combobox", { name: "Meal" });
  fireEvent.focus(field);

  fireEvent.keyDown(field, { key: "ArrowUp" });
  expect(screen.getByRole("option", { name: "Snack" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(screen.getAllByRole("option").every((option) => option.getAttribute("aria-selected") === "false")).toBe(true);
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "Enter" });

  expect(screen.getByRole("status").textContent).toBe("Lunch");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(on_enter).not.toHaveBeenCalled();
  await settle();

  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("a combo field hands free text to on_enter when nothing is lit, and a click takes one", async () => {
  const on_enter = vi.fn();
  const on_take = vi.fn();
  render(<Meal on_enter={on_enter} on_take={on_take} initial="Brunch" />);
  await settle();
  const field = screen.getByRole("combobox", { name: "Meal" });

  fireEvent.focus(field);
  fireEvent.keyDown(field, { key: "Enter" });
  expect(on_enter).toHaveBeenCalledWith("Brunch");

  fireEvent.change(field, { target: { value: "" } });
  await settle();
  fireEvent.click(field);
  fireEvent.mouseDown(screen.getByRole("option", { name: "Dinner" }));
  expect(on_take).toHaveBeenCalledWith("Dinner");
});

test("a combo field told not to list on focus waits for typing", async () => {
  render(<Meal list_on_focus={false} />);
  await settle();
  const field = screen.getByRole("combobox", { name: "Meal" });

  fireEvent.focus(field);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.input(field, { target: { value: "sn" } });
  fireEvent.change(field, { target: { value: "sn" } });
  await settle();

  expect(names()).toEqual(["Snack"]);
});
