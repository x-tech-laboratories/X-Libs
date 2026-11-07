// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

import { set_drag_badge } from "../src/web/drag.ts";

afterEach(() => vi.useRealTimers());

describe("drag badge", () => {
  test("shows the badge as the drag image, then takes it away", () => {
    vi.useFakeTimers();
    const setDragImage = vi.fn();
    const event = { dataTransfer: { setDragImage } as unknown as DataTransfer };

    set_drag_badge(event, "3 tasks");

    const badge = document.querySelector(".drag-badge")!;
    expect(badge.textContent).toBe("3 tasks");
    expect(setDragImage).toHaveBeenCalledWith(badge, -12, -12);

    vi.runAllTimers();
    expect(document.querySelector(".drag-badge")).toBeNull();
  });

  test("takes its own class, and does nothing without a dataTransfer", () => {
    const setDragImage = vi.fn();

    set_drag_badge({ dataTransfer: { setDragImage } as unknown as DataTransfer }, "1 tag", "tag-badge");
    set_drag_badge({ dataTransfer: null }, "nothing");

    expect(setDragImage.mock.calls[0]![0].className).toBe("tag-badge");
    expect(document.body.textContent).not.toContain("nothing");
  });
});
