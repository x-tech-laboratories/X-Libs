// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Outline } from "../src/web/react/outline.tsx";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

const groups = [{ heading: "On this page", items: [{ target: "setup", label: "Set up", level: 2 }, { target: "run", label: "Run it", level: 3 }] }];

describe("outline", () => {
  it("lists each section under its group's heading, its depth kept, the first one marked", () => {
    render(<Outline groups={groups} label="On this page" />);

    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(nav.className).toBe("outline");
    expect(screen.getByText("On this page", { selector: ".outline-heading" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up" }).getAttribute("aria-current")).toBe("location");
    expect(screen.getByRole("link", { name: "Run it" }).getAttribute("href")).toBe("#run");
    expect(screen.getByRole("link", { name: "Run it" }).dataset.level).toBe("3");
  });

  it("jumps to a section, marks it, and puts it in the address only when asked", () => {
    const section = document.createElement("h3");
    section.id = "run";
    section.scrollIntoView = vi.fn();
    document.body.append(section);
    const { rerender } = render(<Outline groups={groups} label="On this page" />);

    fireEvent.click(screen.getByRole("link", { name: "Run it" }));
    expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(screen.getByRole("link", { name: "Run it" }).getAttribute("aria-current")).toBe("location");
    expect(location.hash).toBe("");

    rerender(<Outline groups={groups} label="On this page" update_hash />);
    fireEvent.click(screen.getByRole("link", { name: "Set up" }));
    expect(location.hash).toBe("#setup");
    section.remove();
  });

  it("takes its parts' classes from the class it is given", () => {
    render(<Outline groups={groups} label="Settings sections" class_name="settings-outline" />);

    expect(screen.getByRole("link", { name: "Set up" }).className).toBe("settings-outline-link");
  });
});
