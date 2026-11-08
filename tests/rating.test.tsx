// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Rating } from "../src/web/react/rating.tsx";

afterEach(cleanup);

test("lights the stars up to the value and sets a new one on click", () => {
  const on_change = vi.fn();
  render(<Rating value={3} on_change={on_change} />);

  const slider = screen.getByRole("slider", { name: "Rating" });
  expect(slider.getAttribute("aria-valuenow")).toBe("3");
  expect(slider.getAttribute("aria-valuetext")).toBe("3 stars");
  expect(screen.getByRole("button", { name: "3 stars" }).className).toContain("on");
  expect(screen.getByRole("button", { name: "4 stars" }).className).not.toContain("on");

  fireEvent.click(screen.getByRole("button", { name: "5 stars" }));

  expect(on_change).toHaveBeenCalledWith(5);
});

test("arrow keys move a star, End fills it, and Delete clears to unrated", () => {
  const on_change = vi.fn();
  render(<Rating value={null} on_change={on_change} />);
  const slider = screen.getByRole("slider", { name: "Rating" });
  expect(slider.getAttribute("aria-valuetext")).toBe("Unrated");

  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.keyDown(slider, { key: "End" });
  fireEvent.keyDown(slider, { key: "Delete" });

  expect(on_change.mock.calls.map(([value]) => value)).toEqual([1, 5, null]);
});

test("without on_change the stars only show", () => {
  render(<Rating value={2} />);

  const slider = screen.getByRole("slider", { name: "Rating" });
  expect(slider.getAttribute("aria-readonly")).toBe("true");
  expect(slider.hasAttribute("tabindex")).toBe(false);
  expect((screen.getByRole("button", { name: "1 star" }) as HTMLButtonElement).disabled).toBe(true);
});
