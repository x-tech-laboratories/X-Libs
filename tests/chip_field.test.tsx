// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import { ChipField, with_draft } from "../src/web/react/chip_field.tsx";

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
