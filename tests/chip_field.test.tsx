// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import { ChipField, TreeChipField, with_draft } from "../src/web/react/chip_field.tsx";
import type { TreeItem } from "../src/web/tree.ts";

afterEach(cleanup);

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

function Muscles({ initial }: { initial: string[] }) {
  const [values, set_values] = useState(initial);
  const [draft, set_draft] = useState("");
  return (
    <>
      <ChipField label="Muscles" values={values} on_change={set_values} draft={draft} on_draft={set_draft} suggestions={["Chest", "Triceps", "Shoulders"]} placeholder="Add a muscle" />
      <output>{with_draft(values, draft).join(",")}</output>
    </>
  );
}

function chips(): string[] {
  return [...document.querySelectorAll(".chip")].map((chip) => chip.firstChild?.textContent ?? "");
}

test("lists the chips, says so when there are none, and removes one by its button", () => {
  const { unmount } = render(<Muscles initial={[]} />);
  expect(screen.getByText("None.")).toBeTruthy();
  unmount();

  render(<Muscles initial={["Chest", "Back"]} />);
  expect(chips()).toEqual(["Chest", "Back"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Chest" }));
  expect(chips()).toEqual(["Back"]);
});

test("suggests only values not yet chosen and adds one taken by keyboard", async () => {
  render(<Muscles initial={["Chest"]} />);
  await settle();
  const field = screen.getByRole("combobox", { name: "Muscles" });

  fireEvent.focus(field);
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Triceps", "Shoulders"]);
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "Enter" });
  await settle();

  expect(chips()).toEqual(["Chest", "Triceps"]);
  expect((field as HTMLInputElement).value).toBe("");
});

test("adds free text by Enter or the Add button, which waits for text, and keeps a draft for saving", async () => {
  render(<Muscles initial={[]} />);
  await settle();
  const field = screen.getByRole("combobox", { name: "Muscles" });
  const add = screen.getByRole("button", { name: "Add" });
  expect(add.hasAttribute("disabled")).toBe(true);

  fireEvent.change(field, { target: { value: " Calves " } });
  expect(screen.getByRole("status").textContent).toBe("Calves");
  fireEvent.click(add);
  fireEvent.change(field, { target: { value: "Forearms" } });
  fireEvent.keyDown(field, { key: "Enter" });

  expect(chips()).toEqual(["Calves", "Forearms"]);
  expect(add.hasAttribute("disabled")).toBe(true);
});

interface Category extends TreeItem {
  name: string;
}

const categories: Category[] = [
  { id: "p", parent_id: null, position: 1, name: "Protein" },
  { id: "m", parent_id: "p", position: 1, name: "Meat" },
  { id: "s", parent_id: null, position: 2, name: "Snack" },
];

function Tagged({ initial }: { initial: string[] }) {
  const [values, set_values] = useState(initial);
  return (
    <>
      <TreeChipField label="Categories" items={categories} name_of={(category) => category.name} values={values} on_change={set_values} can_create />
      <output>{values.join(",")}</output>
    </>
  );
}

test("shows each chosen item's path, picks more from the tree and takes new text", () => {
  render(<Tagged initial={["m", "Drinks/Tea"]} />);
  const field = screen.getByRole("combobox", { name: "Categories" });

  expect(chips()).toEqual(["Protein › Meat", "Drinks/Tea"]);
  fireEvent.focus(field);
  expect(screen.getByRole("option", { name: "Meat" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.mouseDown(screen.getByRole("option", { name: "Snack" }));
  expect(screen.getByRole("status").textContent).toBe("m,Drinks/Tea,s");

  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "Fruit" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.getByRole("status").textContent).toBe("m,Drinks/Tea,s,Fruit");

  fireEvent.click(screen.getByRole("button", { name: "Remove Protein › Meat" }));
  expect(screen.getByRole("status").textContent).toBe("Drinks/Tea,s,Fruit");
});
