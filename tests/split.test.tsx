// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResizeHandle } from "../src/web/react/split.tsx";

afterEach(cleanup);

// ============================================================================
// Resize handle
// ============================================================================

describe("resize handle", () => {
  it("resizes with the arrow keys, further with Shift, within its limits", () => {
    const on_resize_end = vi.fn();
    render(<ResizeHandle side="right" size={300} min={200} max={400} default_size={250} on_resize={() => {}} on_resize_end={on_resize_end} label="Resize details" />);
    const handle = screen.getByRole("separator", { name: "Resize details" });

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });

    expect(on_resize_end.mock.calls).toEqual([[316], [236]]);
  });

  it("goes back to its default size on double-click", () => {
    const on_resize_end = vi.fn();
    render(<ResizeHandle side="left" size={300} min={200} max={400} default_size={250} on_resize={() => {}} on_resize_end={on_resize_end} label="Resize sidebar" />);

    fireEvent.doubleClick(screen.getByRole("separator"));

    expect(on_resize_end).toHaveBeenCalledWith(250);
  });
});
