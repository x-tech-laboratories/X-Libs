// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageData } from "../src/site/model.ts";
import { messages_for } from "../src/site/ui_strings.ts";
import { Aside, LinkCard, SitePage } from "../src/web/react/site.tsx";
import { ThemeRow } from "../src/web/react/shell.tsx";
import { theme_choice } from "../src/web/theme.ts";

beforeEach(() => {
  window.scrollTo = () => {};
  localStorage.clear();
});
afterEach(cleanup);

function page_data(changes: Partial<PageData> = {}): PageData {
  return {
    source: "guides/a.mdx",
    path: "/guides/a/",
    href: "/repo/guides/a/",
    base: "/repo/",
    locale: "root",
    lang: "en",
    dir: "ltr",
    title: "Alpha",
    template: "doc",
    headings: [{ id: "setup", text: "Set up", level: 2 }],
    toc: true,
    site: { title: "X-Test", social: [{ icon: "github", label: "GitHub", href: "https://github.com/x" }], search: true, home: "/repo/", theme_key: "x-test-theme" },
    nav: [
      { kind: "link", label: "Home", href: "/repo/" },
      { kind: "group", label: "Guides", collapsed: true, items: [{ kind: "link", label: "Alpha", href: "/repo/guides/a/" }] },
    ],
    next: { label: "Bravo", href: "/repo/guides/b/" },
    edit_url: "https://example.org/edit/content/guides/a.mdx",
    languages: [{ key: "root", label: "English", lang: "en", href: "/repo/guides/a/" }, { key: "es", label: "Español", lang: "es", href: "/repo/es/guides/a/" }],
    ui: messages_for("en"),
    ...changes,
  };
}

function Content() {
  return (
    <>
      <h2 id="setup">Set up</h2>
      <LinkCard title="Join" description="Get involved" href="/join/" />
      <Aside type="tip" title="Tip">Run the tests.</Aside>
    </>
  );
}

describe("site page", () => {
  it("draws the page in the frame: its sidebar, outline, edit link and next page", () => {
    render(<SitePage page={page_data()} Content={Content} />);

    expect(screen.getByRole("heading", { level: 1, name: "Alpha" })).toBeTruthy();
    const current = screen.getAllByRole("link", { name: "Alpha" }).find((link) => link.getAttribute("aria-current") === "page")!;
    expect(current.closest("details")!.open).toBe(true);
    expect(screen.getAllByRole("navigation", { name: "On this page" })[0].textContent).toContain("Set up");
    expect(screen.getByRole("link", { name: "Edit this page" }).getAttribute("href")).toBe("https://example.org/edit/content/guides/a.mdx");
    expect(screen.getByRole("link", { name: /Next\s*Bravo/ }).getAttribute("href")).toBe("/repo/guides/b/");
    expect(screen.getByRole("link", { name: "GitHub" })).toBeTruthy();
    expect(document.querySelector("article")!.hasAttribute("data-pagefind-body")).toBe(true);
  });

  it("moves a link card under the base and marks an aside's kind", () => {
    render(<SitePage page={page_data()} Content={Content} />);

    expect(screen.getByRole("link", { name: /Join/ }).getAttribute("href")).toBe("/repo/join/");
    expect(screen.getByText("Tip").closest("aside")!.dataset.type).toBe("tip");
  });

  it("says when a page is shown in the default language and keeps it out of search", () => {
    render(<SitePage page={page_data({ locale: "es", lang: "es", ui: messages_for("es"), fallback_language: "English" })} Content={Content} />);

    expect(screen.getByText("Esta página aún no está traducida, así que se muestra en English.")).toBeTruthy();
    expect(document.querySelector("article")!.hasAttribute("data-pagefind-body")).toBe(false);
    expect((screen.getByRole("combobox", { name: "Idioma" }) as HTMLSelectElement).value).toBe("es");
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toBeTruthy();
  });

  it("opens the search from its button", async () => {
    const search = vi.fn(async () => [{ title: "Alpha", href: "/repo/guides/a/" }]);
    render(<SitePage page={page_data()} Content={Content} search={search} />);

    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search this site" }), { target: { value: "alpha" } });
    expect((await screen.findByRole("listbox", { name: "Search this site" })).textContent).toContain("Alpha");
    expect(search).toHaveBeenCalledWith("alpha");
  });

  it("leaves the outline out of a landing page and shows its hero", () => {
    render(<SitePage page={page_data({ template: "splash", hero: { title: "Welcome", tagline: "Hello", actions: [{ text: "Start", link: "/start/" }] } })} Content={Content} />);

    expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start" }).getAttribute("href")).toBe("/repo/start/");
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
  });
});

describe("theme row drawn on a server", () => {
  it("draws the system theme until the page is picked up, then the reader's own", async () => {
    localStorage.setItem("x-test-theme", "dark");
    const choice = theme_choice("x-test-theme");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<ThemeRow choice={choice} />);
    document.body.append(container);
    expect(container.textContent).toBe("System theme");

    const recoverable = vi.fn();
    await act(async () => void hydrateRoot(container, <ThemeRow choice={choice} />, { onRecoverableError: recoverable }));

    expect(container.textContent).toBe("Dark theme");
    expect(recoverable).not.toHaveBeenCalled();
    container.remove();
  });
});
