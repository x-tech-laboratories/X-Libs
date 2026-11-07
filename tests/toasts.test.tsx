// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Toasts, undoable, type Undoable } from "../src/web/react/toasts.tsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Starts an undoable action inside act, since it changes the toasts on show.
function start(message: string, options: Parameters<typeof undoable>[1]): Undoable {
  let started: Undoable | undefined;
  act(() => { started = undoable(message, options); });
  return started!;
}

// A commit and an undo that count their calls.
function action() {
  return { commit: vi.fn(), undo: vi.fn() };
}

describe("undoable", () => {
  test("Undo takes the action back and never commits it", () => {
    render(<Toasts />);
    const deleting = action();
    const pending = start("Deleted 3 tasks", deleting);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    act(() => vi.runAllTimers());

    expect(deleting.undo).toHaveBeenCalledTimes(1);
    expect(deleting.commit).not.toHaveBeenCalled();
    expect(pending.settled).toBe(true);
  });

  test("commits once the toast times out or is dismissed", () => {
    render(<Toasts />);
    const timing_out = action();
    const dismissed = action();
    start("Deleted", { ...timing_out, duration_in_milliseconds: 1000 });
    start("Moved", { ...dismissed, undo_label: "Put back" });

    expect(screen.getByRole("button", { name: "Put back" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]!);
    act(() => vi.advanceTimersByTime(1000));

    expect(timing_out.commit).toHaveBeenCalledTimes(1);
    expect(dismissed.commit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Deleted")).toBeNull();
  });

  test("finish commits and undo undoes early, each only once", () => {
    render(<Toasts />);
    const finished = action();
    const undone = action();
    const first = start("First", finished);
    const second = start("Second", undone);

    act(() => { first.finish(); first.finish(); first.undo(); });
    act(() => { second.undo(); second.finish(); });
    act(() => vi.runAllTimers());

    expect(finished.commit).toHaveBeenCalledTimes(1);
    expect(finished.undo).not.toHaveBeenCalled();
    expect(undone.undo).toHaveBeenCalledTimes(1);
    expect(undone.commit).not.toHaveBeenCalled();
    expect(screen.queryByText("First")).toBeNull();
  });
});
