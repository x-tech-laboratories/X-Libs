// @vitest-environment jsdom
import "./dom_stubs.ts";

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
