// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Badge, Chip, StatusPill } from "../src/web/react/badges.tsx";

test("a badge shows its text with its tone as a class", () => {
  render(<Badge tone="good">Healthy</Badge>);

  expect(screen.getByText("Healthy").className).toContain("good");
});

test("a status pill shows its dot's tone, its text and its action", () => {
  render(<StatusPill tone="warn" busy label="Paused" action={<button>Resume</button>} title="Background research" />);

  const pill = screen.getByTitle("Background research");
  expect(pill.querySelector(".status-dot")!.className).toBe("status-dot tone-warn busy");
  expect(screen.getByText("Paused")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
});

test("a chip in its item's colour is tinted with it and can be removed", () => {
  const remove = vi.fn();
  render(<Chip color="#ff0000" dashed on_remove={remove} remove_label="Remove tag Home">Home</Chip>);

  const chip = screen.getByText("Home");
  expect(chip.className).toBe("chip has-color dashed");
  expect(chip.style.getPropertyValue("--item-color")).toBe("#ff0000");
  fireEvent.click(screen.getByRole("button", { name: "Remove tag Home" }));
  expect(remove).toHaveBeenCalledOnce();
});
