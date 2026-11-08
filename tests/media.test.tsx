// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListPicker, type PickableList } from "../src/web/react/list_picker.tsx";
import { Avatar, MediaGrid, MediaTile } from "../src/web/react/media.tsx";
import { MenuButton } from "../src/web/react/menu_button.tsx";
import { ContextMenus } from "../src/web/react/menus.tsx";

afterEach(cleanup);

// ============================================================================
// Avatars
// ============================================================================

describe("avatar", () => {
  it("shows the picture when there is one", () => {
    const { container } = render(<Avatar src="https://example.com/a.jpg" name="Cool Channel" size="small" />);

    expect(container.querySelector("img")!.className).toBe("avatar avatar-small");
  });

  it("shows the name's first letter when there is no picture", () => {
    render(<Avatar name=" élan" />);

    expect(screen.getByText("É").className).toBe("avatar avatar-medium avatar-initial");
  });
});

// ============================================================================
// Tiles
// ============================================================================

describe("media tile", () => {
  it("links its title, shows the corner text, and leaves out empty lines", () => {
    render(
      <MediaGrid label="Videos">
        <MediaTile title="Cool Video" href="#/watch/abc" image="https://example.com/t.jpg" corner="3:07" lines={["Cool Channel", undefined, "", "1.4M views"]} />
      </MediaGrid>,
    );

    expect(screen.getByRole("link", { name: "Cool Video" }).getAttribute("href")).toBe("#/watch/abc");
    expect(screen.getByText("3:07").className).toBe("media-corner");
    expect(screen.getByRole("listitem").querySelectorAll(".media-line")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Videos" }).className).toBe("media-grid");
  });

  it("fades when dimmed, and lays out as rows with a lead and actions", () => {
    render(
      <MediaGrid rows>
        <MediaTile title="First" href="#/watch/a" dimmed lead={1} actions={<button>Remove</button>} />
      </MediaGrid>,
    );

    const tile = screen.getByRole("listitem");
    expect(tile.className).toBe("media-tile media-dimmed dimmed");
    expect(tile.querySelector(".media-lead")!.textContent).toBe("1");
    expect(tile.querySelector(".media-blank")).not.toBeNull();
    expect(screen.getByRole("list").className).toBe("media-grid media-rows");
  });
});

// ============================================================================
// Menu button
// ============================================================================

describe("menu button", () => {
  it("opens its menu without letting the click reach an enclosing link", () => {
    const run = vi.fn();
    const outer_click = vi.fn();
    render(
      <>
        <div onClick={outer_click}><MenuButton label="Options for Cool Video" items={() => [{ label: "Copy link", run }]} /></div>
        <ContextMenus />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Options for Cool Video" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    expect(outer_click).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says whether its menu is open, also once the menu closes by Escape", () => {
    render(
      <>
        <MenuButton label="Options" items={[{ label: "Copy link", run: () => {} }]} />
        <ContextMenus />
      </>,
    );
    const button = screen.getByRole("button", { name: "Options" });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});

// ============================================================================
// List picker
// ============================================================================

describe("list picker", () => {
  function lists(): PickableList[] {
    return [
      { id: "a", name: "Favourites", count: 2, holds: true },
      { id: "b", name: "Later", count: 0, holds: false },
    ];
  }

  it("ticks the lists that hold the thing and adds it to another", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    render(<ListPicker options={{ title: "Add to playlist", load: async () => lists(), add, create: vi.fn() }} on_close={() => {}} />);

    const later = await screen.findByRole("button", { name: /Later/ });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Favourites/ }).disabled).toBe(true);
    await act(async () => fireEvent.click(later));

    expect(add).toHaveBeenCalledWith("b");
    expect(later.getAttribute("aria-pressed")).toBe("true");
    expect(later.textContent).toContain("1");
  });

  it("makes a new list holding the thing", async () => {
    const create = vi.fn().mockResolvedValue({ id: "c", name: "Road trip", count: 1, holds: true });
    render(<ListPicker options={{ title: "Add to playlist", load: async () => [], add: vi.fn(), create, new_label: "New playlist", empty_text: "No playlists yet." }} on_close={() => {}} />);

    expect(await screen.findByText("No playlists yet.")).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "New playlist" }), { target: { value: " Road trip " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create" })));

    expect(create).toHaveBeenCalledWith("Road trip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Road trip/ }).getAttribute("aria-pressed")).toBe("true"));
  });
});
