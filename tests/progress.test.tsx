// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ProgressBar } from "../src/web/react/progress.tsx";

afterEach(cleanup);

test("a progress bar tells its value and shows the percentage as its detail", () => {
  render(<ProgressBar value={120} max={600} label="Scan" detail />);

  const bar = screen.getByRole("progressbar", { name: "Scan" });
  expect(bar.getAttribute("aria-valuenow")).toBe("120");
  expect(bar.getAttribute("aria-valuemax")).toBe("600");
  expect(bar.style.getPropertyValue("--progress")).toBe("20%");
  expect(screen.getByText("20%")).toBeTruthy();
});

test("an unknown amount of work draws the bar busy without a value", () => {
  render(<ProgressBar value={null} label="Finding files" detail="Finding files… 1,204" />);

  const bar = screen.getByRole("progressbar", { name: "Finding files" });
  expect(bar.className).toContain("indeterminate");
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  expect(screen.getByText("Finding files… 1,204")).toBeTruthy();
});
