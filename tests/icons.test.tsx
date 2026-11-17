// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import * as icons from "../src/web/react/icons.tsx";
import { CloseIcon, Icon, PlayIcon, RefreshIcon } from "../src/web/react/icons.tsx";

afterEach(cleanup);

test("an icon without a label is decoration a screen reader skips", () => {
  const { container } = render(<button type="button">Play <Icon icon={PlayIcon} /></button>);
  const svg = container.querySelector("svg")!;

  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("role")).toBeNull();
  expect(svg.getAttribute("focusable")).toBe("false");
  expect(screen.getByRole("button").textContent).toBe("Play ");
});

test("an icon with a label is an image named by it", () => {
  render(<button type="button"><Icon icon={CloseIcon} label="Close" /></button>);

  const image = screen.getByRole("img", { name: "Close" });
  expect(image.getAttribute("aria-hidden")).toBeNull();
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
});

test("draws in the text's colour at Halon's icon sizes", () => {
  const { container } = render(<><Icon icon={PlayIcon} /><Icon icon={PlayIcon} size="large" className="extra" /></>);
  const [small, large] = [...container.querySelectorAll("svg")];

  expect(small!.getAttribute("stroke")).toBe("currentColor");
  expect(small!.getAttribute("stroke-width")).toBe("2");
  expect(small!.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(small!.classList.contains("line-icon")).toBe(true);
  expect(small!.getAttribute("style")).toBeNull();
  expect(large!.style.width).toBe("var(--icon-size-large)");
  expect(large!.style.height).toBe("var(--icon-size-large)");
  expect(large!.classList.contains("extra")).toBe(true);
});

test("a spinning icon takes Halon's spinning class", () => {
  const { container } = render(<Icon icon={RefreshIcon} spinning />);

  expect(container.querySelector("svg")!.classList.contains("spinning")).toBe(true);
});

test("every glyph in the set draws", () => {
  const glyphs = Object.entries(icons).filter(([name]) => name.endsWith("Icon") && name !== "Icon");
  expect(glyphs.length).toBeGreaterThan(60);

  for (const [name, glyph] of glyphs) {
    const { container, unmount } = render(<Icon icon={glyph as icons.IconGlyph} />);
    expect(container.querySelector("svg path, svg rect, svg circle, svg line, svg polyline, svg polygon"), name).not.toBeNull();
    unmount();
  }
});
