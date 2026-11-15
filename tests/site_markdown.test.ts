import { compile } from "@mdx-js/mdx";
import { describe, expect, it } from "vitest";

import { redirect_html } from "../src/site/build.ts";
import rehype_raw from "rehype-raw";

import { rehype_base_links, remark_drop_title_heading, remark_github_alerts } from "../src/site/markdown.ts";

async function compiled(text: string, format: "md" | "mdx" = "md"): Promise<string> {
  const output = await compile(text, { format, remarkPlugins: [remark_github_alerts], rehypePlugins: [[rehype_base_links, "/repo/"]], jsx: true });
  return String(output);
}

describe("GitHub alerts", () => {
  it("draws a quote opening with a marker as an aside of its kind, titled", async () => {
    const page = await compiled("> [!TIP]\n> Make an *Area* group.\n");

    expect(page).toContain(`aside className="site-aside" data-type="tip"`);
    expect(page).toContain(`p className="site-aside-title">{"Tip"}`);
    expect(page).toContain("Make an ");
    expect(page).not.toContain("[!TIP]");
  });

  it("maps a warning to a caution and leaves a plain quote alone", async () => {
    expect(await compiled("> [!WARNING]\n> Back up first.\n")).toContain(`data-type="caution"`);
    expect(await compiled("> Just a quote.\n")).toContain("_components.blockquote>");
  });
});

describe("base links", () => {
  it("moves root links under the base in Markdown and in a component's props", async () => {
    const page = await compiled(`[Join](/join/) ![Shot](/assets/a.png) [Away](https://example.org/)\n\n<LinkCard title="Tasks" href="/tasks/" />\n`, "mdx");

    expect(page).toContain(`href="/repo/join/"`);
    expect(page).toContain(`src="/repo/assets/a.png"`);
    expect(page).toContain(`href="https://example.org/"`);
    expect(page).toContain(`LinkCard title="Tasks" href="/repo/tasks/"`);
  });
});

describe("redirects", () => {
  it("sends the reader on to the new address and keeps the page out of search", () => {
    const page = redirect_html("/repo/user/tasks/");

    expect(page).toContain(`<meta http-equiv="refresh" content="0; url=/repo/user/tasks/">`);
    expect(page).toContain(`<link rel="canonical" href="/repo/user/tasks/">`);
    expect(page).toContain(`<meta name="robots" content="noindex">`);
  });
});

describe("title heading", () => {
  it("leaves out a page's opening # heading but keeps later ones", async () => {
    const output = await compile("# RoboBuddy\n\nText.\n\n# Later\n", { format: "md", remarkPlugins: [remark_drop_title_heading], jsx: true });
    const page = String(output);

    expect(page).not.toContain("RoboBuddy");
    expect(page).toContain("Later");
  });
});

describe("raw HTML", () => {
  it("keeps a README's HTML table and its pictures, moved under the base", async () => {
    const output = await compile(`<table><tr><td><img src="/shots/happy.png" width="160" alt="happy"></td></tr></table>\n`, {
      format: "md",
      rehypePlugins: [rehype_raw, [rehype_base_links, "/repo/"]],
      jsx: true,
    });

    expect(String(output)).toContain(`src="/repo/shots/happy.png" width="160" alt="happy"`);
  });
});
