// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Badge, StatusPill } from "../src/web/react/badges.tsx";

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
