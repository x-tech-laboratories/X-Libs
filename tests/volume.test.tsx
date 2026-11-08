// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { VolumeButton } from "../src/web/react/volume.tsx";

afterEach(cleanup);

test("clicking opens a slider whose change sets the volume", () => {
  const on_change = vi.fn();
  render(<VolumeButton volume={40} on_change={on_change} />);

  const button = screen.getByRole("button", { name: "Volume 40%" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");

  fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "65" } });

  expect(on_change).toHaveBeenCalledWith(65);
});

test("scrolling over the button steps the volume and a middle-click mutes, then unmutes to the level before", () => {
  const on_change = vi.fn();
  const { rerender } = render(<VolumeButton volume={40} on_change={on_change} step={5} />);
  const button = screen.getByRole("button", { name: "Volume 40%" });

  fireEvent.wheel(button, { deltaY: -100 });
  expect(on_change).toHaveBeenLastCalledWith(45);
  fireEvent.wheel(button, { deltaY: 100 });
  expect(on_change).toHaveBeenLastCalledWith(35);

  const middle_click = () => new MouseEvent("auxclick", { button: 1, bubbles: true });
  fireEvent(button, middle_click());
  expect(on_change).toHaveBeenLastCalledWith(0);
  rerender(<VolumeButton volume={0} on_change={on_change} step={5} />);
  fireEvent(screen.getByRole("button", { name: "Volume 0%" }), middle_click());
  expect(on_change).toHaveBeenLastCalledWith(40);
});
