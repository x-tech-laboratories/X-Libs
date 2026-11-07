// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeButton } from "../src/web/react/shell.tsx";
import { theme_choice, type Theme } from "../src/web/theme.ts";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

// ============================================================================
// Theme
// ============================================================================

describe("theme choice", () => {
  it("keeps the choice in this browser by default", () => {
    const choice = theme_choice("x-test-theme");

    choice.set("dark");

    expect(localStorage.getItem("x-test-theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(choice.get()).toBe("dark");
  });

  it("keeps the choice in the app's own settings when given a storage", () => {
    const settings: { theme?: Theme } = { theme: "light" };
    const choice = theme_choice({ read: () => settings.theme, write: (theme) => { settings.theme = theme; } });
    render(<ThemeButton choice={choice} />);

    fireEvent.click(screen.getByRole("button"));

    expect(settings.theme).toBe("dark");
    expect(localStorage.length).toBe(0);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Theme: dark, click to change");
  });

  it("follows the system when the storage holds nothing", () => {
    const choice = theme_choice({ read: () => undefined, write: () => {} });

    choice.apply();

    expect(choice.get()).toBe("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
