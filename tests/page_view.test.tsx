// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PageView } from "../src/web/react/page_view.tsx";

afterEach(cleanup);

const sections = [{ id: "library", label: "Library" }, { id: "folders", label: "Folders" }] as const;

test("a page view is a full dialog with its title, actions, Close and section tabs", () => {
  const on_close = vi.fn();
  const on_section = vi.fn();
  render(
    <PageView title="Settings" subtitle="X-Music" on_close={on_close} actions={<button>Merge</button>} sections={[...sections]} section="library" on_section={on_section}>
      <p>Body</p>
    </PageView>,
  );

  expect(screen.getByRole("dialog", { name: "Settings" }).className).toContain("full");
  expect(screen.getByText("X-Music")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Merge" })).toBeTruthy();
  const tabs = screen.getByRole("navigation", { name: "Settings sections" });
  expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe("Library");

  fireEvent.click(screen.getByRole("button", { name: "Folders" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(on_section).toHaveBeenCalledWith("folders");
  expect(on_close).toHaveBeenCalledTimes(1);
});

test("without sections there are no tabs", () => {
  render(<PageView title="Properties" on_close={() => {}}><p>Body</p></PageView>);

  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.getByText("Body")).toBeTruthy();
});
