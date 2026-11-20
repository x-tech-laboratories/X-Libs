// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PathInput, Select } from "../src/web/react/controls.tsx";
import { CopyButton, copy_text } from "../src/web/react/copy_button.tsx";
import { Toasts } from "../src/web/react/toasts.tsx";

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

function clipboard(fails = false): string[] {
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => (fails ? Promise.reject(new Error("denied")) : void copied.push(text)) } });
  return copied;
}

describe("the copy button", () => {
  it("copies its text and says so", async () => {
    const copied = clipboard();
    render(
      <>
        <Toasts />
        <CopyButton text="https://example.org/hook" title="Copy the payload URL" />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy the payload URL" }));

    expect(await screen.findByText("Copied.")).toBeTruthy();
    expect(copied).toEqual(["https://example.org/hook"]);
  });

  it("asks for its text only when pressed, and says why when that fails", async () => {
    const copied = clipboard();
    const fetch_text = vi.fn().mockResolvedValueOnce("given on request").mockRejectedValueOnce(new Error("Not allowed."));
    render(
      <>
        <Toasts />
        <CopyButton text={fetch_text} label="Copy secret" copied_text="Secret copied." />
      </>,
    );
    expect(fetch_text).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Copy secret" }));
    expect(await screen.findByText("Secret copied.")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Copy secret" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Copy secret" }));

    expect(await screen.findByText("Not allowed.")).toBeTruthy();
    expect(copied).toEqual(["given on request"]);
  });

  it("says when the browser will not copy", async () => {
    render(<Toasts />);

    expect(await copy_text("x")).toBe(false);
    clipboard(true);
    expect(await copy_text("y")).toBe(false);
    expect(await screen.findAllByText("Could not copy; select the text and copy it by hand.")).toHaveLength(2);
  });
});

describe("controls for a page that cannot change or pick", () => {
  it("a select can be disabled", () => {
    render(<Select label="Mode" options={[["a", "A"]]} value="a" on_change={() => undefined} disabled />);

    expect((screen.getByRole("combobox", { name: "Mode" }) as HTMLSelectElement).disabled).toBe(true);
  });

  it("a path is only typed when there is no picker", () => {
    const on_change = vi.fn();
    render(<PathInput label="Checkout" value="" on_change={on_change} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Checkout" }), { target: { value: "/srv/repo" } });

    expect(on_change).toHaveBeenCalledWith("/srv/repo");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
