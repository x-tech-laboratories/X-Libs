// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, Dialogs, confirm_dialog } from "../src/web/react/dialog.tsx";
import { Toasts, toast } from "../src/web/react/toasts.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ============================================================================
// Dialog
// ============================================================================

function DialogOpener() {
  const [open, set_open] = useState(false);
  return (
    <>
      <button onClick={() => set_open(true)}>Edit</button>
      {open && <Dialog title="Edit task" wide on_close={() => set_open(false)} buttons={<button onClick={() => set_open(false)}>Done</button>}>Body</Dialog>}
    </>
  );
}

describe("dialog", () => {
  it("gives focus back to the button that opened it once it closes", () => {
    render(<DialogOpener />);
    const opener = screen.getByRole("button", { name: "Edit" });
    opener.focus();

    fireEvent.click(opener);
    expect(document.querySelector("dialog")!.className).toBe("dialog wide");
    screen.getByRole("button", { name: "Done" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("dialog form", () => {
  it("submits from Enter in a field or the submit button, but not from Cancel", () => {
    const on_submit = vi.fn();
    const on_close = vi.fn();
    render(
      <Dialog title="Rename" on_close={on_close} form={{ on_submit, submit_label: "Save" }} buttons={<button type="button" onClick={on_close}>Cancel</button>}>
        <input aria-label="Name" />
      </Dialog>,
    );
    const save = screen.getByRole("button", { name: "Save" });

    expect(save.getAttribute("type")).toBe("submit");
    expect(save.className).toBe("accent solid");
    expect(save.closest("form")!.className).toBe("dialog-form");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(on_submit).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).form!);
    fireEvent.click(save);

    expect(on_submit).toHaveBeenCalledTimes(2);
    expect(on_close).toHaveBeenCalledTimes(1);
  });

  it("shows a subtitle and header actions, and fills the window when full", () => {
    render(<Dialog title="Album" subtitle="12 tracks" actions={<button>Play</button>} full on_close={() => {}}>Body</Dialog>);
    const dialog = screen.getByRole("dialog", { name: "Album" });

    expect(dialog.className).toBe("dialog full");
    expect(screen.getByText("12 tracks").className).toBe("dialog-subtitle");
    expect(screen.getByRole("button", { name: "Play" }).parentElement!.className).toBe("dialog-actions");
    expect(dialog.querySelector(".dialog-buttons")).toBeNull();
  });

  it("still confirms from anywhere and closes once the action is done", async () => {
    const run = vi.fn(async () => {});
    render(<Dialogs />);

    act(() => confirm_dialog({ title: "Delete?", message: "Gone for good.", confirm_label: "Delete", danger: true, run }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Delete" })));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ============================================================================
// Toasts
// ============================================================================

describe("undo toast", () => {
  it("runs the action on Undo and says it closed by the action", () => {
    const undo = vi.fn();
    const on_close = vi.fn();
    render(<Toasts />);

    act(() => void toast('Deleted "Bake"', { action: { text: "Undo", run: undo }, duration_in_milliseconds: 10000, on_close }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(undo).toHaveBeenCalledTimes(1);
    expect(on_close).toHaveBeenCalledWith("action");
    expect(screen.queryByText('Deleted "Bake"')).toBeNull();
  });

  it("tells the owner when its time runs out, so the removal can go through", () => {
    vi.useFakeTimers();
    const on_close = vi.fn();
    render(<Toasts />);

    act(() => void toast("Deleted 2 tasks", { action: { text: "Undo", run: () => {} }, duration_in_milliseconds: 10000, on_close }));
    act(() => vi.advanceTimersByTime(10000));

    expect(on_close).toHaveBeenCalledWith("timeout");
    expect(screen.queryByText("Deleted 2 tasks")).toBeNull();
  });

  it("says it was closed early when its owner closes it", () => {
    const on_close = vi.fn();
    render(<Toasts />);

    const close = toast("Deleted 3 tasks", { sticky: true, on_close });
    act(() => close());
    act(() => close());

    expect(on_close).toHaveBeenCalledTimes(1);
    expect(on_close).toHaveBeenCalledWith("closed");
  });
});
