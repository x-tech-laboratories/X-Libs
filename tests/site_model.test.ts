import { describe, expect, it } from "vitest";

import { build_sidebar, extract_headings, neighbours, page_path, place_of_file, plan_routes, with_base, type SourcePage } from "../src/site/model.ts";
import { messages_for, site_message_keys, site_messages } from "../src/site/ui_strings.ts";

const page = (id: string, locale: string, slug: string, frontmatter: SourcePage["frontmatter"] = {}): SourcePage => ({ id, locale, slug, frontmatter: { title: slug || "Home", ...frontmatter } });

// ============================================================================
// Addresses
// ============================================================================

describe("addresses", () => {
  it("places a file in its locale and slug, an index file at its folder", () => {
    const locales = ["root", "es"];

    expect(place_of_file("index.mdx", locales)).toEqual({ locale: "root", slug: "" });
    expect(place_of_file("guidelines/index.mdx", locales)).toEqual({ locale: "root", slug: "guidelines" });
    expect(place_of_file("es/join.md", locales)).toEqual({ locale: "es", slug: "join" });
    expect(place_of_file("estimates/a.mdx", locales)).toEqual({ locale: "root", slug: "estimates/a" });
    expect(place_of_file("es.mdx", locales)).toEqual({ locale: "root", slug: "es" });
  });

  it("serves the default language at the top and the others under their key, with the base in front", () => {
    expect(page_path("root", "")).toBe("/");
    expect(page_path("root", "guidelines/testing")).toBe("/guidelines/testing/");
    expect(page_path("es", "")).toBe("/es/");
    expect(with_base("/repo/", "/join/")).toBe("/repo/join/");
    expect(with_base("/", "/join/")).toBe("/join/");
    expect(with_base("/repo/", "https://example.org/")).toBe("https://example.org/");
    expect(with_base("/repo/", "//cdn.example.org/a.js")).toBe("//cdn.example.org/a.js");
    expect(with_base("/repo/", "#top")).toBe("#top");
  });
});

// ============================================================================
// Routes
// ============================================================================

describe("routes", () => {
  it("serves each locale's own pages and the default language's where it has none", () => {
    const pages = [page("index.mdx", "root", ""), page("join.mdx", "root", "join"), page("es/index.mdx", "es", ""), page("es/only.mdx", "es", "only")];
    const routes = plan_routes(pages, ["root", "es"]);

    expect(routes.map((route) => [route.path, route.page.id, route.is_fallback])).toEqual([
      ["/", "index.mdx", false],
      ["/join/", "join.mdx", false],
      ["/es/", "es/index.mdx", false],
      ["/es/join/", "join.mdx", true],
      ["/es/only/", "es/only.mdx", false],
    ]);
  });
});

// ============================================================================
// Sidebar
// ============================================================================

describe("sidebar", () => {
  const pages = [
    page("index.mdx", "root", ""),
    page("guides/index.mdx", "root", "guides", { title: "Guides", sidebar: { label: "Overview", order: 0 } }),
    page("guides/b.mdx", "root", "guides/b", { title: "Bravo", sidebar: { order: 2 } }),
    page("guides/a.mdx", "root", "guides/a", { title: "Alpha", sidebar: { order: 2 } }),
    page("guides/first.mdx", "root", "guides/first", { title: "Zulu", sidebar: { order: 1 } }),
    page("guides/hidden.mdx", "root", "guides/hidden", { sidebar: { hidden: true } }),
    page("es/guides/a.mdx", "es", "guides/a", { title: "Alfa", sidebar: { order: 2 } }),
  ];
  const routes = plan_routes(pages, ["root", "es"]);
  const entries = [
    { slug: "", label: "Home", translations: { es: "Inicio" } },
    { label: "Guides", translations: { es: "Guías" }, autogenerate: { directory: "guides" } },
    { label: "More", items: [{ label: "Source", link: "https://example.org/" }], collapsed: true },
  ];

  it("orders a folder by sidebar order, then title, leaving hidden pages out, under the base", () => {
    const nav = build_sidebar(entries, routes, "root", "/repo/");

    expect(nav[0]).toEqual({ kind: "link", label: "Home", href: "/repo/" });
    expect(nav[1]).toMatchObject({ kind: "group", label: "Guides", collapsed: false });
    expect(nav[1].kind === "group" && nav[1].items.map((item) => item.label)).toEqual(["Overview", "Zulu", "Alpha", "Bravo"]);
    expect(nav[2]).toEqual({ kind: "group", label: "More", collapsed: true, items: [{ kind: "link", label: "Source", href: "https://example.org/" }] });
  });

  it("nests each subfolder as a group headed by its index page, however deep", () => {
    const deep_pages = [
      page("guides/index.mdx", "root", "guides", { title: "Guides", sidebar: { label: "Overview", order: 0 } }),
      page("guides/setup.mdx", "root", "guides/setup", { title: "Setup" }),
      page("guides/advanced/index.mdx", "root", "guides/advanced", { title: "Advanced", sidebar: { label: "Overview", order: 0 } }),
      page("guides/advanced/tuning.mdx", "root", "guides/advanced/tuning", { title: "Tuning" }),
      page("guides/advanced/deep/deeper/last.mdx", "root", "guides/advanced/deep/deeper/last", { title: "Last" }),
      page("guides/advanced/secret.mdx", "root", "guides/advanced/secret", { sidebar: { hidden: true } }),
    ];
    const deep_routes = plan_routes(deep_pages, ["root"]);

    const nav = build_sidebar([{ label: "Guides", autogenerate: { directory: "guides" }, collapsed: true }], deep_routes, "root", "/");

    expect(nav).toEqual([{ kind: "group", label: "Guides", collapsed: true, items: [
      { kind: "link", label: "Overview", href: "/guides/" },
      { kind: "group", label: "Advanced", collapsed: true, items: [
        { kind: "link", label: "Overview", href: "/guides/advanced/" },
        { kind: "group", label: "deep", collapsed: true, items: [
          { kind: "group", label: "deeper", collapsed: true, items: [{ kind: "link", label: "Last", href: "/guides/advanced/deep/deeper/last/" }] },
        ] },
        { kind: "link", label: "Tuning", href: "/guides/advanced/tuning/" },
      ] },
      { kind: "link", label: "Setup", href: "/guides/setup/" },
    ] }]);
  });

  it("labels and links a locale's sidebar in that locale", () => {
    const nav = build_sidebar(entries, routes, "es", "/");

    expect(nav[0]).toEqual({ kind: "link", label: "Inicio", href: "/es/" });
    expect(nav[1].kind === "group" && nav[1].items.map((item) => item.kind === "link" && `${item.label} ${item.href}`)).toEqual([
      "Overview /es/guides/", "Zulu /es/guides/first/", "Alfa /es/guides/a/", "Bravo /es/guides/b/",
    ]);
  });

  it("refuses a page that does not exist", () => {
    expect(() => build_sidebar([{ slug: "missing" }], routes, "root", "/")).toThrow("missing");
  });

  it("finds the pages before and after one, skipping other sites", () => {
    const nav = build_sidebar(entries, routes, "root", "/");

    expect(neighbours(nav, "/guides/first/")).toEqual({ previous: { label: "Overview", href: "/guides/" }, next: { label: "Alpha", href: "/guides/a/" } });
    expect(neighbours(nav, "/guides/b/").next).toBeUndefined();
    expect(neighbours(nav, "/nowhere/")).toEqual({});
  });
});

// ============================================================================
// Headings
// ============================================================================

describe("headings", () => {
  it("reads second and third level headings with ids, without their anchor links, entities decoded", () => {
    const html = [
      `<h1 id="title">Title</h1>`,
      `<h2 id="setup">Set <code>up</code> &amp; run<a class="heading-anchor" href="#setup">#</a></h2>`,
      `<h3 class="x" id="caf%C3%A9">Caf&#xe9; &lt;3</h3>`,
      `<h2>No id</h2>`,
      `<h4 id="deep">Deep</h4>`,
    ].join("");

    expect(extract_headings(html)).toEqual([
      { id: "setup", text: "Set up & run", level: 2 },
      { id: "caf%C3%A9", text: "Café <3", level: 3 },
    ]);
  });
});

// ============================================================================
// The frame's words
// ============================================================================

describe("frame words", () => {
  it("layers the site's words over the language's over English", () => {
    const words = messages_for("es-MX", { es: { search: "Busca" } });

    expect(words.search).toBe("Busca");
    expect(words.next).toBe("Siguiente");
    expect(messages_for("ja").next).toBe("Next");
  });

  it("translates every word in every built-in language", () => {
    for (const [language, words] of Object.entries(site_messages)) {
      expect(Object.keys(words).sort(), language).toEqual([...site_message_keys].sort());
    }
  });
});
