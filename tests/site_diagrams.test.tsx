// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageData } from "../src/site/model.ts";
import { messages_for } from "../src/site/ui_strings.ts";
import { SitePage } from "../src/web/react/site.tsx";
import { mermaid_drawer, mermaid_theme, type MermaidModule } from "../src/web/site/mermaid.ts";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

// ── Setup ────────────────────────────────────────────────────────────────────

const source = "flowchart LR\n  a --> b\n";

function page_data(): PageData {
  return {
    source: "flows.md", path: "/flows/", href: "/flows/", base: "/", locale: "root", lang: "en", dir: "ltr", title: "Flows", template: "doc",
    headings: [], toc: false, site: { title: "X-Test", social: [], search: false, home: "/", theme_key: "x-test-theme" }, nav: [], languages: [], ui: messages_for("en"),
  };
}

// A page holding one mermaid block and one block of code, as the build compiles them.
function Content({ components }: { components?: Record<string, ComponentType<never>> }) {
  const Pre = (components?.pre ?? "pre") as ComponentType<{ "data-mermaid"?: string; children?: string }>;
  return (
    <>
      <Pre data-mermaid="">{source}</Pre>
      <Pre>const x = 1;</Pre>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

describe("diagrams on a page", () => {
  it("draws the source on the server, and keeps other code as code", () => {
    const html = renderToString(<SitePage page={page_data()} Content={Content} />);

    expect(html).toContain(`class="site-diagram-source"`);
    expect(html).toContain("a --&gt; b");
    expect(html).toContain("<pre>const x = 1;</pre>");
  });

  it("swaps the source for the drawn diagram, and draws it again for the dark scheme", async () => {
    const draw = vi.fn(async (_text: string, dark: boolean) => `<svg data-dark="${dark}"></svg>`);
    const { container } = render(<SitePage page={page_data()} Content={Content} draw_diagram={draw} />);

    await act(async () => {});
    expect(draw).toHaveBeenCalledWith(source, false);
    expect(container.querySelector(".site-diagram svg")?.getAttribute("data-dark")).toBe("false");

    await act(async () => {
      document.documentElement.dataset.theme = "dark";
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector(".site-diagram svg")?.getAttribute("data-dark")).toBe("true");
  });

  it("keeps the source when the diagram cannot be drawn", async () => {
    render(<SitePage page={page_data()} Content={Content} draw_diagram={() => Promise.reject(new Error("Parse error"))} />);

    await act(async () => {});
    expect(screen.getByText(/a --> b/).className).toBe("site-diagram-source");
  });
});

// ── Drawer ───────────────────────────────────────────────────────────────────

describe("mermaid drawer", () => {
  it("loads mermaid once and sets its colours again only when the scheme changes", async () => {
    const mermaid: MermaidModule = { initialize: vi.fn(), render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })) };
    const load = vi.fn(async () => ({ default: mermaid }));
    const draw = mermaid_drawer(load);

    const drawn = await Promise.all([draw(source, false), draw(source, false), draw(source, true)]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect(drawn).toEqual([`<svg id="site-diagram-1"></svg>`, `<svg id="site-diagram-2"></svg>`, `<svg id="site-diagram-3"></svg>`]);
  });

  it("colours diagrams from the page's tokens, with defaults for each scheme", () => {
    const tokens: Record<string, string> = { "--text-body": "#101010", "--surface-default": "#fafafa" };

    const light = mermaid_theme((token) => tokens[token] ?? "", false);
    const dark = mermaid_theme(() => "", true);

    expect(light).toMatchObject({ darkMode: false, primaryTextColor: "#101010", background: "#fafafa" });
    expect(dark).toMatchObject({ darkMode: true, primaryTextColor: "#e2e8f0", background: "#16213a" });
  });
});
