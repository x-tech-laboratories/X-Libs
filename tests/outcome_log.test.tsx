// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tone } from "../src/web/react/badges.tsx";
import { OutcomeLog } from "../src/web/react/outcome_log.tsx";

afterEach(cleanup);

type Outcome = "new" | "unchanged" | "failed";

interface FileResult {
  path: string;
  outcome: Outcome;
  detail?: string;
}

const outcomes: Record<Outcome, [string, Tone]> = { new: ["New", "good"], unchanged: ["Unchanged", "none"], failed: ["Failed", "bad"] };

const results: FileResult[] = [
  { path: "/music/a.flac", outcome: "new" },
  { path: "/music/b.flac", outcome: "unchanged" },
  { path: "/music/c.flac", outcome: "new" },
];

function log(entries: FileResult[], extra: { active?: boolean; on_filter_change?: (filter: Outcome | null) => void } = {}) {
  return (
    <OutcomeLog
      label="Scanned files" entries={entries} outcome_of={(entry) => entry.outcome} outcomes={outcomes}
      item_of={(entry) => entry.path} detail_of={(entry) => entry.detail} {...extra}
    />
  );
}

const shown_paths = () => within(screen.getByRole("table", { name: "Scanned files" })).queryAllByText(/\/music\//).map((cell) => cell.textContent);

// jsdom lays nothing out, so the scrolling box's sizes are set by hand.
function size(element: HTMLElement, scroll_height: number, client_height: number): void {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scroll_height });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: client_height });
}

describe("outcome log", () => {
  it("shows each entry with its outcome badge, item and detail in a captioned table", () => {
    render(log([...results, { path: "/music/d.flac", outcome: "failed", detail: "not audio" }]));

    expect(shown_paths()).toEqual(["/music/a.flac", "/music/b.flac", "/music/c.flac", "/music/d.flac"]);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(expect.arrayContaining(["Outcome", "Item", "Detail"]));
    expect(screen.getByText("not audio")).toBeTruthy();
    expect(within(screen.getByRole("table")).getAllByText("New")).toHaveLength(2);
  });

  it("tallies the outcomes that happened and filters by one", () => {
    const on_filter_change = vi.fn();
    render(log(results, { on_filter_change }));

    const filter = screen.getByRole("radiogroup", { name: "Show" });
    expect(within(filter).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["All 3", "New 2", "Unchanged 1"]);
    fireEvent.click(within(filter).getByRole("radio", { name: "New 2" }));

    expect(on_filter_change).toHaveBeenCalledWith("new");
    expect(shown_paths()).toEqual(["/music/a.flac", "/music/c.flac"]);
    fireEvent.click(within(filter).getByRole("radio", { name: "All 3" }));
    expect(shown_paths()).toHaveLength(3);
  });

  it("follows the newest entries while they arrive until the reader scrolls up", () => {
    const { rerender } = render(log(results.slice(0, 1), { active: true }));
    const scroll_box = screen.getByRole("table").parentElement!;
    size(scroll_box, 1000, 200);
    const follow = screen.getByRole("checkbox", { name: "Follow" }) as HTMLInputElement;

    rerender(log(results.slice(0, 2), { active: true }));
    expect(scroll_box.scrollTop).toBe(1000);

    scroll_box.scrollTop = 100;
    fireEvent.scroll(scroll_box);
    expect(follow.checked).toBe(false);
    size(scroll_box, 1200, 200);
    rerender(log(results, { active: true }));
    expect(scroll_box.scrollTop).toBe(100);

    rerender(log(results, { active: false }));
    expect(follow.disabled).toBe(true);
  });

  it("keeps each entry one line high, the full item and detail in their hover text", () => {
    render(log([{ path: "/music/a very long folder name/a.flac", outcome: "failed", detail: "not audio" }], { active: true }));

    expect(screen.getByRole("table").parentElement!.className).toBe("table-wrap virtual single-line fit following-output");
    expect(screen.getByText("/music/a very long folder name/a.flac").getAttribute("title")).toBe("/music/a very long folder name/a.flac");
    expect(screen.getByText("not audio").getAttribute("title")).toBe("not audio");
  });

  it("says so when there is nothing yet", () => {
    render(log([]));

    expect(screen.getByText("Nothing yet")).toBeTruthy();
  });
});
