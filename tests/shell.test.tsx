// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FolderIcon, HistoryIcon } from "../src/web/react/icons.tsx";
import { Shell, shell_labels, use_side_pane, type ShellSidePane } from "../src/web/react/shell.tsx";
import { theme_choice } from "../src/web/theme.ts";

beforeEach(() => {
  window.scrollTo = () => {};
  localStorage.clear();
});
afterEach(cleanup);

// ============================================================================
// Sidebar
// ============================================================================

const sections = [{ id: "", label: "Overview", href: "#/" }, { id: "runs", label: "Runs", href: "#/runs" }];
const layout_width = () => document.querySelector<HTMLElement>(".layout")!.style.getPropertyValue("--sidebar-width");

describe("shell sidebar", () => {
  it("lists the sections, lighting up the active one", () => {
    render(<Shell brand="X-Test" sections={sections} active="runs" theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    expect(screen.getByRole("link", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeTruthy();
  });

  it("draws the brand's icon before its name", () => {
    render(<Shell brand="X-Test" brand_icon="icon.svg" sections={sections} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    const brand = screen.getByRole("link", { name: "X-Test" });
    expect(brand.firstElementChild?.getAttribute("src")).toBe("icon.svg");
  });

  it("draws the brand's full logo alone, named for screen readers, in place of the icon and name", () => {
    render(<Shell brand="X-Test" brand_icon="icon.svg" brand_logo="logo.svg" sections={sections} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    const brand = screen.getByRole("link", { name: "X-Test" });
    expect(brand.children).toHaveLength(1);
    expect(brand.firstElementChild?.getAttribute("src")).toBe("logo.svg");
    expect(brand.textContent).toBe("");
  });

  it("folds sections open onto their items, lighting up the active item", () => {
    const folding = [
      { id: "", label: "Overview", href: "#/" },
      { id: "hosts", label: "Hosts", href: "#/hosts", children: [{ id: "odin", label: "Odin", href: "#/hosts/odin" }, { id: "thor", label: "Thor", href: "#/hosts/thor" }] },
    ];
    const selected = () => screen.getAllByRole("treeitem").filter((item) => item.getAttribute("aria-selected") === "true").map((item) => item.dataset.id);
    render(<Shell brand="X-Test" sections={folding} active="hosts" active_item="thor" sections_pref="x-test-sidebar" sidebar={<p>Extra</p>} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    expect(screen.getByRole("tree", { name: "Main" })).toBeTruthy();
    expect(screen.getByText("Extra")).toBeTruthy();
    expect(selected()).toEqual(["hosts/thor"]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Hosts" }));

    expect(selected()).toEqual(["section:hosts"]);
    expect(screen.queryByText("Thor")).toBeNull();
    expect(JSON.parse(localStorage.getItem("x-test-sidebar")!)).toEqual(["section:hosts"]);
  });

  it("lights up a section with no such item and goes to a row's page when picked", () => {
    const folding = [{ id: "hosts", label: "Hosts", href: "#/hosts", children: [{ id: "odin", label: "Odin", href: "#/hosts/odin" }] }];
    render(<Shell brand="X-Test" sections={folding} active="hosts" active_item="gone" theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    expect(screen.getByRole("treeitem", { selected: true }).dataset.id).toBe("section:hosts");

    fireEvent.click(screen.getByText("Odin"));

    expect(window.location.hash).toBe("#/hosts/odin");
  });

  it("shows the app's own sidebar in place of the sections", () => {
    render(<Shell brand="X-Test" sections={sections} sidebar={<button>My Day</button>} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    expect(screen.queryByRole("link", { name: "Runs" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main" }).textContent).toContain("My Day");
  });

  it("puts the app's views with their icons above its own sidebar, in the one navigation landmark", () => {
    const views = [{ id: "folders", label: "Folders", href: "#/folders", icon: FolderIcon }, { id: "history", label: "History", href: "#/history", icon: HistoryIcon }];
    render(<Shell brand="X-Test" views={views} active="history" sidebar={<p>Now playing</p>} settings={{ href: "#/settings" }} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(navigation.className).toBe("sidebar-nav");
    expect([...navigation.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["Folders", "History"]);
    expect(navigation.textContent).not.toContain("Now playing");
    expect(screen.getByRole("link", { name: "History" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "History" }).className).toBe("tree-row active");
    expect(screen.getByRole("link", { name: "Folders" }).getAttribute("aria-current")).toBeNull();
    expect(navigation.querySelectorAll("svg.line-icon[aria-hidden='true']")).toHaveLength(2);

    const sidebar = screen.getByRole("complementary");
    expect(sidebar.id).toBe("sidebar");
    const content = sidebar.querySelector(".sidebar-content")!;
    expect(content.firstElementChild).toBe(navigation);
    expect(screen.getByText("Now playing").parentElement).toBe(content);
    expect(sidebar.querySelector(".sidebar-foot")!.textContent).toContain("Settings");
  });

  it("draws the views alone when the app has no sidebar of its own", () => {
    render(<Shell brand="X-Test" views={[{ id: "runs", label: "Runs", href: "#/runs" }]} active="runs" theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    expect(screen.getByRole("navigation", { name: "Main" }).parentElement!.className).toBe("sidebar-content");
    expect(screen.getByRole("link", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
  });

  it("moves focus into the sidebar when the phone menu opens and back on Escape", () => {
    render(<Shell brand="X-Test" sidebar={<button>My Day</button>} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);
    const menu_button = screen.getByRole("button", { name: "Open the menu" });

    fireEvent.click(menu_button);
    expect(document.activeElement?.textContent).toBe("My Day");
    expect(document.body.classList.contains("menu-open")).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(menu_button);
    expect(document.body.classList.contains("menu-open")).toBe(false);
  });

  it("resizes the sidebar from the keyboard, keeps the width, and resets on double-click", () => {
    const width = { default_width: 240, min: 180, max: 480, storage_key: "x-test-sidebar" };
    render(<Shell brand="X-Test" sections={sections} sidebar_width={width} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);
    const handle = screen.getByRole("separator", { name: "Resize the sidebar" });

    expect(layout_width()).toBe("240px");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(layout_width()).toBe("256px");
    expect(document.body.style.getPropertyValue("--sidebar-width")).toBe("256px");
    expect(localStorage.getItem("x-test-sidebar")).toBe("[256]");

    fireEvent.doubleClick(handle);
    expect(layout_width()).toBe("240px");
  });

  it("hands the width to the app when it keeps the width itself", () => {
    const on_change = vi.fn();
    render(<Shell brand="X-Test" sections={sections} sidebar_width={{ default_width: 240, min: 180, max: 480, width: 470, on_change }} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the sidebar" }), { key: "ArrowRight" });

    expect(layout_width()).toBe("470px");
    expect(on_change).toHaveBeenCalledWith(480, true);
  });
});

// ============================================================================
// Top bar and menu
// ============================================================================

describe("shell top bar", () => {
  it("without logins shows the tools and theme but no user or logout", () => {
    render(<Shell brand="X-Test" brand_href="#/today" sidebar={<button>My Day</button>} tools={<input aria-label="Search" />} theme={theme_choice("x-test-theme")} on_logout={() => {}} main_class="panes">Page</Shell>);

    expect(screen.getByRole("link", { name: "X-Test" }).getAttribute("href")).toBe("#/today");
    expect(screen.getByRole("textbox", { name: "Search" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System theme" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(document.body.classList.contains("logged-out")).toBe(false);
    expect(screen.getByRole("main").className).toBe("panes");
  });

  it("on the login page hides the tools", () => {
    render(<Shell brand="X-Test" tools={<input aria-label="Search" />} theme={theme_choice("x-test-theme")} user={null}>Page</Shell>);

    expect(screen.queryByRole("textbox", { name: "Search" })).toBeNull();
    expect(document.body.classList.contains("logged-out")).toBe(true);
  });

  it("shows no account name for an empty user, and keeps the tools when told the user is not logged out", () => {
    const { rerender } = render(<Shell brand="X-Test" tools={<input aria-label="Search" />} theme={theme_choice("x-test-theme")} user="" on_logout={() => {}}>Page</Shell>);
    expect(document.querySelector(".user-name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();

    rerender(<Shell brand="X-Test" tools={<input aria-label="Search" />} theme={theme_choice("x-test-theme")} user={null} logged_out={false}>Page</Shell>);
    expect(screen.getByRole("textbox", { name: "Search" })).toBeTruthy();
    expect(document.body.classList.contains("logged-out")).toBe(false);
    expect(document.querySelector(".user-name")).toBeNull();
  });

  it("holds the app's sidebar in a content box and draws a status bar at the foot", () => {
    render(<Shell brand="X-Test" sidebar={<p>Not a link</p>} sidebar_foot={<p>Settings</p>} status_bar={<span>3 picked</span>} theme={theme_choice("x-test-theme")}>Page</Shell>);

    expect(screen.getByText("Not a link").parentElement!.className).toBe("sidebar-content");
    expect(screen.getByText("Settings").parentElement!.className).toBe("sidebar-foot");
    expect(screen.getByRole("contentinfo").className).toBe("status-bar");
    expect(screen.getByRole("contentinfo").textContent).toBe("3 picked");
    expect(document.body.classList.contains("has-status-bar")).toBe(true);
  });

  it("pins the app's rows, the theme, the account and Settings, in that order, below the sections", () => {
    const on_logout = vi.fn();
    render(<Shell brand="X-Test" sections={sections} active="settings" sidebar_foot={<p>Live</p>} settings={{ href: "#/settings" }} theme={theme_choice("x-test-theme")} user="ada" user_href="#/account" on_logout={on_logout}>Page</Shell>);

    expect(screen.getByRole("link", { name: "Runs" }).parentElement!.className).toBe("sidebar-links");
    const foot = document.querySelector(".sidebar-foot")!;
    expect([...foot.querySelectorAll("p, button, a")].map((row) => row.textContent)).toEqual(["Live", "System theme", "ada", "Sign out", "Settings"]);
    expect(document.querySelector(".topbar")!.textContent).not.toContain("ada");
    expect(screen.getByRole("link", { name: "ada" }).getAttribute("href")).toBe("#/account");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "System theme" }));
    expect(screen.getByRole("button", { name: "Light theme" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(on_logout).toHaveBeenCalled();
  });

  it("hands the click on Settings to an app that opens it itself", () => {
    const on_open = vi.fn();
    render(<Shell brand="X-Test" sidebar={<p>Tags</p>} settings={{ href: "?settings", active: false, on_open }} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);
    const link = screen.getByRole("link", { name: "Settings" });

    expect(link.getAttribute("aria-current")).toBeNull();
    fireEvent.click(link);
    expect(on_open).toHaveBeenCalled();
  });

  it("hands the phone menu to an app that holds it", () => {
    const on_menu_open_change = vi.fn();
    const { rerender } = render(<Shell brand="X-Test" menu_open={false} on_menu_open_change={on_menu_open_change} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    fireEvent.click(screen.getByRole("button", { name: "Open the menu" }));
    expect(on_menu_open_change).toHaveBeenLastCalledWith(true);
    expect(document.body.classList.contains("menu-open")).toBe(false);

    rerender(<Shell brand="X-Test" menu_open={true} on_menu_open_change={on_menu_open_change} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);
    expect(document.body.classList.contains("menu-open")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(on_menu_open_change).toHaveBeenLastCalledWith(false);
  });

  it("heads the sidebar with the brand and keeps the window still when asked", () => {
    render(<Shell brand="X-Test" sidebar={<button>My Day</button>} brand_in_sidebar contained theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    expect(screen.getByRole("link", { name: "X-Test" }).className).toBe("sidebar-brand");
    expect(document.querySelector(".topbar .brand")).toBeNull();
    expect(document.body.classList.contains("contained")).toBe(true);
  });
});

// ============================================================================
// Side pane
// ============================================================================

function PaneShell({ pane = {}, pref_key = "x-test-pane-open", children = <button>In main</button> }: { pane?: Partial<ShellSidePane>; pref_key?: string; children?: React.ReactNode }) {
  const [open, set_open] = use_side_pane(pref_key);
  return (
    <Shell brand="X-Test" sections={sections} theme={theme_choice("x-test-theme")} user="ada" tools={<button onClick={() => set_open(!open)}>Assistant</button>}
      side_pane={{ title: "Assistant", open, on_open_change: set_open, content: <><input aria-label="Message" /><button>Send</button></>, ...pane }}>
      {children}
    </Shell>
  );
}

const pane = () => screen.queryByRole("complementary", { name: "Assistant" });
const main_width = () => document.querySelector<HTMLElement>("main")!.style.getPropertyValue("--side-pane-width");

describe("shell side pane", () => {
  it("opens beside main with its title and closes from its close button, remembering which in its pref", () => {
    const { unmount } = render(<PaneShell />);
    expect(pane()).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(document.querySelector("main")!.className).toBe("with-side-pane");
    expect(main_width()).toBe("0px");

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(pane()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Assistant" }).closest(".topbar")).toBeTruthy();
    expect(main_width()).toBe("");
    expect(localStorage.getItem("x-test-pane-open")).toBe("true");

    unmount();
    render(<PaneShell />);
    expect(pane()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Assistant" }));
    expect(pane()).toBeNull();
    expect(localStorage.getItem("x-test-pane-open")).toBe("false");
  });

  it("keeps main's children in place, with their state, as the pane opens and closes", () => {
    function Counter() {
      const [count, set_count] = useState(0);
      return <button onClick={() => set_count(count + 1)}>Counted {count}</button>;
    }
    render(<PaneShell><Counter /></PaneShell>);
    fireEvent.click(screen.getByRole("button", { name: "Counted 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Assistant" }));
    expect(screen.getByRole("button", { name: "Counted 1" }).closest(".main-pane")).toBeTruthy();
  });

  it("closes on Escape inside it, but not from a field, and gives focus back to what opened it", () => {
    render(<PaneShell />);
    const opener = screen.getByRole("button", { name: "Assistant" });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Escape" });
    expect(pane()).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.keyDown(send, { key: "Enter" });
    expect(pane()).toBeTruthy();
    fireEvent.keyDown(send, { key: "Escape" });
    expect(pane()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("gives focus to main when what opened it is gone", () => {
    function Opener() {
      const [open, set_open] = useState(false);
      return (
        <Shell brand="X-Test" sections={sections} theme={theme_choice("x-test-theme")} user="ada" side_pane={{ title: "Details", open, on_open_change: set_open, content: <button>Inside</button> }}>
          {!open && <button onClick={() => set_open(true)}>Open details</button>}
        </Shell>
      );
    }
    render(<Opener />);
    screen.getByRole("button", { name: "Open details" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    screen.getByRole("button", { name: "Inside" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Close Details" }));
    expect(document.activeElement).toBe(document.querySelector("main"));
  });

  it("takes the app's own head and tools, and words in another language", () => {
    const labels = { ...shell_labels_for_test(), close_side_pane: (title: string) => `${title} schließen` };
    function Own() {
      return (
        <Shell brand="X-Test" sections={sections} theme={theme_choice("x-test-theme")} user="ada" labels={labels}
          side_pane={{ title: "Aufgabe", open: true, on_open_change: () => {}, head: <input aria-label="Titel" />, tools: <button>Verlauf</button>, content: "Body" }}>
          Page
        </Shell>
      );
    }
    render(<Own />);
    expect(screen.queryByRole("heading", { name: "Aufgabe" })).toBeNull();
    const head = screen.getByRole("textbox", { name: "Titel" }).parentElement!;
    expect([...head.children].map((child) => child.getAttribute("aria-label") ?? child.textContent)).toEqual(["Titel", "Verlauf", "Aufgabe schließen"]);
    expect(screen.getByRole("complementary", { name: "Aufgabe" }).textContent).toContain("Body");
  });

  it("resizes from its left edge, keeping the width in this browser", () => {
    render(<PaneShell pane={{ width: { default_width: 360, min: 280, max: 600, storage_key: "x-test-pane-width" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    const handle = screen.getByRole("separator", { name: "Resize Assistant" });
    expect(handle.getAttribute("aria-valuenow")).toBe("360");
    expect(main_width()).toBe("360px");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    const grown = Number(handle.getAttribute("aria-valuenow"));
    expect(grown).toBeGreaterThan(360);
    expect(main_width()).toBe(`${grown}px`);
    expect(document.body.style.getPropertyValue("--side-pane-width")).toBe(`${grown}px`);
    expect(localStorage.getItem("x-test-pane-width")).toContain(String(grown));
  });

  it("covers main on a phone with its head at its top, following the window across the width", () => {
    const listeners = new Set<() => void>();
    let narrow = true;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      get matches() { return query === "(max-width: 700px)" && narrow; },
      media: query, onchange: null, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      render(<PaneShell />);
      fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
      expect(screen.getByRole("button", { name: "Close Assistant" }).closest("aside")).toBe(pane());
      expect(document.querySelector(".topbar .side-pane-head")).toBeNull();
      // It is the screen's height, not main's, with main hidden behind it, so its foot stays in sight.
      expect(pane()!.style.height).toBe("calc(100dvh - var(--frame-height))");
      expect(pane()!.style.position).toBe("relative");
      expect(document.querySelector<HTMLElement>(".main-pane")!.hidden).toBe(true);

      narrow = false;
      act(() => listeners.forEach((listener) => listener()));
      expect(screen.getByRole("button", { name: "Close Assistant" }).closest(".topbar")).toBeTruthy();
      expect(pane()!.style.height).toBe("");
      expect(document.querySelector<HTMLElement>(".main-pane")!.hidden).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it("is hidden while logged out", () => {
    render(
      <Shell brand="X-Test" theme={theme_choice("x-test-theme")} user={null} side_pane={{ title: "Assistant", open: true, on_open_change: () => {}, content: "Body" }}>
        Sign in
      </Shell>,
    );
    expect(pane()).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Assistant" })).toBeNull();
  });
});

function shell_labels_for_test() {
  return { ...shell_labels };
}
