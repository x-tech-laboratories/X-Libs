// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { FollowingOutput, at_bottom } from "../src/web/react/following.tsx";

afterEach(cleanup);

// jsdom lays nothing out, so the box's sizes are set by hand.
function size(element: HTMLElement, scroll_height: number, client_height: number): void {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scroll_height });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: client_height });
}

describe("at_bottom", () => {
  test("allows a little slack above the end", () => {
    const element = document.createElement("div");
    size(element, 1000, 200);
    element.scrollTop = 795;
    expect(at_bottom(element)).toBe(true);
    element.scrollTop = 700;
    expect(at_bottom(element)).toBe(false);
  });
});

describe("FollowingOutput", () => {
  test("follows the tail as text arrives, stops once the reader scrolls up, and resumes at the end", () => {
    const { rerender } = render(<FollowingOutput text="one" toggle />);
    const output = screen.getByText("one");
    size(output, 1000, 200);
    const follow = screen.getByRole("checkbox", { name: "Follow" }) as HTMLInputElement;
    expect(follow.checked).toBe(true);

    rerender(<FollowingOutput text="one two" toggle />);
    expect(output.scrollTop).toBe(1000);

    output.scrollTop = 300;
    fireEvent.scroll(output);
    expect(follow.checked).toBe(false);
    size(output, 1200, 200);
    rerender(<FollowingOutput text="one two three" toggle />);
    expect(output.scrollTop).toBe(300);

    output.scrollTop = 1000;
    fireEvent.scroll(output);
    expect(follow.checked).toBe(true);
    size(output, 1400, 200);
    rerender(<FollowingOutput text="one two three four" toggle />);
    expect(output.scrollTop).toBe(1400);
  });

  test("the Follow switch is off limits once the output is done, and ticking it scrolls to the end", () => {
    const { rerender } = render(<FollowingOutput text="line" toggle />);
    const output = screen.getByText("line");
    size(output, 1000, 200);
    const follow = screen.getByRole("checkbox", { name: "Follow" }) as HTMLInputElement;

    output.scrollTop = 100;
    fireEvent.scroll(output);
    fireEvent.click(follow);
    expect(follow.checked).toBe(true);
    expect(output.scrollTop).toBe(1000);

    rerender(<FollowingOutput text="line" toggle active={false} />);
    expect(follow.disabled).toBe(true);
  });
});
