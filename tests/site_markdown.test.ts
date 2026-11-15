import { compile } from "@mdx-js/mdx";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { plan_site, redirect_html, write_entries, type SiteProject } from "../src/site/build.ts";
import rehype_raw from "rehype-raw";

import { has_mermaid, rehype_base_links, rehype_mermaid_blocks, remark_drop_title_heading, remark_github_alerts } from "../src/site/markdown.ts";

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

describe("mermaid blocks", () => {
  it("keeps a mermaid block's source in a marked pre and leaves other code alone", async () => {
    const output = await compile("```mermaid\nflowchart LR\n  a --> b\n```\n\n```ts\nconst x = 1;\n```\n", { format: "md", rehypePlugins: [rehype_mermaid_blocks], jsx: true });
    const page = String(output);

    expect(page).toContain(`_components.pre data-mermaid=""`);
    expect(page).toContain("flowchart LR\\n  a --> b");
    expect(page).toContain(`className="language-ts"`);
  });

  it("finds a mermaid fence in a page's text", () => {
    expect(has_mermaid("Intro\n\n```mermaid\nerDiagram\n```\n")).toBe(true);
    expect(has_mermaid("  ~~~ mermaid\n")).toBe(true);
    expect(has_mermaid("```ts\nconst mermaid = 1;\n```\n")).toBe(false);
  });

  it("loads mermaid in the browser entry only when a page draws a diagram", () => {
    const root = mkdtempSync(join(tmpdir(), "x-site-"));
    try {
      const content = join(root, "docs");
      mkdirSync(content);
      writeFileSync(join(content, "index.md"), "# Home\n");
      const project: SiteProject = { root, config: { title: "Test" }, base: "/", content_folder: content, out_folder: join(root, "dist"), work_folder: join(root, ".x-site") };
      const client = () => readFileSync(join(project.work_folder, "client.js"), "utf8");

      write_entries(project, plan_site(project));
      expect(client()).not.toContain("mermaid");

      writeFileSync(join(content, "flow.md"), "# Flow\n\n```mermaid\nflowchart LR\n```\n");
      write_entries(project, plan_site(project));
      expect(client()).toContain(`start_site(pages, { draw_diagram: mermaid_drawer(() => import("mermaid")) });`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
