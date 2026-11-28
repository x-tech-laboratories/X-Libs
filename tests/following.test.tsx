// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { FollowingOutput, at_bottom, use_follow_tail } from "../src/web/react/following.tsx";

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

    output.scrollTop = 1000;
    fireEvent.scroll(output);
    output.scrollTop = 100;
    fireEvent.scroll(output);
    fireEvent.click(follow);
    expect(follow.checked).toBe(true);
    expect(output.scrollTop).toBe(1000);

    rerender(<FollowingOutput text="line" toggle active={false} />);
    expect(follow.disabled).toBe(true);
  });
});

describe("use_follow_tail", () => {
  function Box({ text, active = true }: { text: string; active?: boolean }) {
    const tail = use_follow_tail<HTMLDivElement>(text, active);
    return (
      <>
        <div ref={tail.ref} onScroll={tail.on_scroll}>
          {text}
        </div>
        <span>{tail.following ? "following" : "let go"}</span>
        <button type="button" onClick={tail.jump}>
          Jump to latest
        </button>
      </>
    );
  }

  test("keeps following when its own scroll lands short as content grows, and lets go only when the reader scrolls up", () => {
    const { rerender } = render(<Box text="one" />);
    const box = screen.getByText("one");
    size(box, 1000, 200);
    rerender(<Box text="one two" />);
    expect(box.scrollTop).toBe(1000);

    // More arrived before the scroll event, so the box is short of the end though it never moved up.
    size(box, 1400, 200);
    fireEvent.scroll(box);
    expect(screen.getByText("following")).toBeTruthy();
    rerender(<Box text="one two three" />);
    expect(box.scrollTop).toBe(1400);

    box.scrollTop = 500;
    fireEvent.scroll(box);
    expect(screen.getByText("let go")).toBeTruthy();
    rerender(<Box text="one two three four" />);
    expect(box.scrollTop).toBe(500);

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(box.scrollTop).toBe(1400);
    expect(screen.getByText("following")).toBeTruthy();
  });

  test("leaves the following alone while inactive", () => {
    const { rerender } = render(<Box text="done" active={false} />);
    const box = screen.getByText("done");
    size(box, 1000, 200);
    box.scrollTop = 100;
    fireEvent.scroll(box);
    expect(screen.getByText("following")).toBeTruthy();
    rerender(<Box text="done" active />);
    expect(box.scrollTop).toBe(1000);
  });
});
