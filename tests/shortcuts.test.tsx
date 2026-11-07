// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { describe_keys, is_typing, matches_keys, use_shortcuts, type Shortcut } from "../src/web/react/shortcuts.ts";

function Shortcuts({ shortcuts, children }: { shortcuts: Shortcut[]; children?: React.ReactNode }) {
  use_shortcuts(shortcuts);
  return <div>{children}</div>;
}

const key_event = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

afterEach(() => document.body.replaceChildren());

// ── Keys ─────────────────────────────────────────────────────────────────────

describe("matching keys", () => {
  test("mod is Ctrl elsewhere and Cmd on Apple devices", () => {
    expect(matches_keys("mod+z", key_event({ key: "z", ctrlKey: true }), false)).toBe(true);
    expect(matches_keys("mod+z", key_event({ key: "z", metaKey: true }), false)).toBe(false);
    expect(matches_keys("mod+z", key_event({ key: "z", metaKey: true }), true)).toBe(true);
  });

  test("modifiers must match exactly", () => {
    expect(matches_keys("mod+z", key_event({ key: "Z", ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(matches_keys("ctrl+shift+a", key_event({ key: "A", ctrlKey: true, shiftKey: true }), false)).toBe(true);
  });

  test("named keys, aliases and Shift-typed punctuation match", () => {
    expect(matches_keys("escape", key_event({ key: "Escape" }), false)).toBe(true);
    expect(matches_keys("esc", key_event({ key: "Escape" }), false)).toBe(true);
    expect(matches_keys("?", key_event({ key: "?", shiftKey: true }), false)).toBe(true);
    expect(matches_keys("ctrl++", key_event({ key: "+", ctrlKey: true }), false)).toBe(true);
  });

  test("a letter also matches by its physical key", () => {
    expect(matches_keys("alt+a", key_event({ key: "å", code: "KeyA", altKey: true }), true)).toBe(true);
  });

  test("describes keys for help text", () => {
    expect(describe_keys("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
    expect(describe_keys("mod+shift+z", true)).toBe("⇧⌘Z");
    expect(describe_keys("escape", false)).toBe("Esc");
    expect(describe_keys("alt+arrowup", false)).toBe("Alt+↑");
  });
});

// ── Guards ───────────────────────────────────────────────────────────────────

describe("guards", () => {
  test("text fields, selects and editable regions count as typing", () => {
    render(
      <div>
        <input data-testid="input" />
        <textarea data-testid="textarea" />
        <select data-testid="select" />
        <div contentEditable data-testid="editable"><span data-testid="inside" /></div>
        <button data-testid="button" />
      </div>,
    );

    for (const id of ["input", "textarea", "select", "editable", "inside"]) expect(is_typing(document.querySelector(`[data-testid=${id}]`))).toBe(true);
    expect(is_typing(document.querySelector("[data-testid=button]"))).toBe(false);
  });
});

// ── Hook ─────────────────────────────────────────────────────────────────────

describe("use_shortcuts", () => {
  test("runs a matching shortcut and stops the browser's own action", () => {
    const run = vi.fn();
    render(<Shortcuts shortcuts={[{ keys: "ctrl+a", run }]} />);

    const event = key_event({ key: "a", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  test("stays quiet in a text field unless the shortcut asks to fire there", () => {
    const outside = vi.fn();
    const always = vi.fn();
    const { getByRole } = render(<Shortcuts shortcuts={[{ keys: "escape", run: outside }, { keys: "mod+s", when: "always", run: always }]}><input /></Shortcuts>);

    fireEvent.keyDown(getByRole("textbox"), { key: "Escape" });
    fireEvent.keyDown(getByRole("textbox"), { key: "s", ctrlKey: true });

    expect(outside).not.toHaveBeenCalled();
    expect(always).toHaveBeenCalledOnce();
  });

  test("waits while a dialog is open unless the shortcut opts in", () => {
    const page = vi.fn();
    const over = vi.fn();
    render(<Shortcuts shortcuts={[{ keys: "a", run: page }, { keys: "b", over_overlays: true, run: over }]}><dialog open /></Shortcuts>);

    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "b" });

    expect(page).not.toHaveBeenCalled();
    expect(over).toHaveBeenCalledOnce();
  });

  test("uses the latest shortcuts and stops listening once unmounted", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = render(<Shortcuts shortcuts={[{ keys: "x", run: first }]} />);

    rerender(<Shortcuts shortcuts={[{ keys: "x", run: second }]} />);
    fireEvent.keyDown(document.body, { key: "x" });
    unmount();
    fireEvent.keyDown(document.body, { key: "x" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
