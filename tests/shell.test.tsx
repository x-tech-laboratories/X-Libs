// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "../src/web/react/shell.tsx";
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

  it("shows the app's own sidebar in place of the sections", () => {
    render(<Shell brand="X-Test" sections={sections} sidebar={<button>My Day</button>} theme={theme_choice("x-test-theme")} user="ada">Page</Shell>);

    expect(screen.queryByRole("link", { name: "Runs" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main" }).textContent).toContain("My Day");
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
    expect(document.getElementById("theme")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();

    rerender(<Shell brand="X-Test" tools={<input aria-label="Search" />} theme={theme_choice("x-test-theme")} user={null} logged_out={false}>Page</Shell>);
    expect(screen.getByRole("textbox", { name: "Search" })).toBeTruthy();
    expect(document.body.classList.contains("logged-out")).toBe(false);
    expect(document.querySelector(".user-name")).toBeNull();
  });

  it("holds the app's sidebar in a content box and draws a status bar at the foot", () => {
    render(<Shell brand="X-Test" sidebar={<p>Not a link</p>} status_bar={<span>3 picked</span>} theme={theme_choice("x-test-theme")}>Page</Shell>);

    expect(screen.getByText("Not a link").parentElement!.className).toBe("sidebar-content");
    expect(screen.getByRole("contentinfo").className).toBe("status-bar");
    expect(screen.getByRole("contentinfo").textContent).toBe("3 picked");
    expect(document.body.classList.contains("has-status-bar")).toBe(true);
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
