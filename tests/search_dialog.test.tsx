// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchButton, SearchDialog, type SearchHit } from "../src/web/react/search_dialog.tsx";

afterEach(cleanup);

const hits: SearchHit[] = [
  { title: "Testing", href: "/testing/", excerpt: "write <mark>tests</mark> first<script>alert(1)</script>", parts: [{ title: "The loop", href: "/testing/#the-loop", excerpt: "failing <mark>tests</mark>" }] },
  { title: "Review", href: "/review/" },
];

function open_dialog(search: (query: string) => Promise<SearchHit[]>, on_open = vi.fn(), on_close = vi.fn()) {
  render(<SearchDialog search={search} on_open={on_open} on_close={on_close} delay_in_milliseconds={0} labels={{ title: "Search this site" }} />);
  return { field: screen.getByRole("combobox", { name: "Search this site" }), on_open, on_close };
}

describe("search dialog", () => {
  it("shows each page found with its matching sections, keeping only the marks in an excerpt", async () => {
    const search = vi.fn(async () => hits);
    const { field } = open_dialog(search);

    fireEvent.change(field, { target: { value: " tests " } });
    const options = await screen.findAllByRole("option");

    expect(search).toHaveBeenCalledWith("tests");
    expect(options.map((option) => option.querySelector(".search-dialog-title")!.textContent)).toEqual(["Testing", "The loop", "Review"]);
    expect(options[0].querySelector(".search-dialog-excerpt")!.innerHTML).toBe("write <mark>tests</mark> first");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(field.getAttribute("aria-activedescendant")).toBe(options[0].id);
  });

  it("moves through the hits with the arrow keys, wrapping round, and opens one with Enter", async () => {
    const { field, on_open, on_close } = open_dialog(async () => hits);

    fireEvent.change(field, { target: { value: "tests" } });
    await screen.findAllByRole("option");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(on_open).toHaveBeenCalledWith("/review/");
    expect(on_close).toHaveBeenCalled();
  });

  it("says when nothing matched and when the search failed", async () => {
    const search = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("No index yet."));
    const { field } = open_dialog(search);

    fireEvent.change(field, { target: { value: "zebra" } });
    expect(await screen.findByText("Nothing found for “zebra”.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "zebras" } });
    expect(await screen.findByText("No index yet.")).toBeTruthy();
  });
});

describe("search button", () => {
  it("opens the search when clicked and from Ctrl+K", () => {
    const on_open = vi.fn();
    render(<SearchButton label="Search" on_open={on_open} />);

    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(on_open).toHaveBeenCalledTimes(2);
  });
});
