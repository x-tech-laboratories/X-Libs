import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { list_content_files, read_content, read_frontmatter } from "../src/site/content.ts";

let folder = "";

function write(path: string, text: string): void {
  mkdirSync(join(folder, path, ".."), { recursive: true });
  writeFileSync(join(folder, path), text);
}

afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("site content", () => {
  it("reads the YAML frontmatter, or nothing when a file has none", () => {
    expect(read_frontmatter("---\ntitle: Join\nsidebar:\n  order: 2\n---\n\nText")).toEqual({ title: "Join", sidebar: { order: 2 } });
    expect(read_frontmatter("# Just text")).toEqual({});
  });

  it("lists the Markdown and MDX files in order and places each in its locale", () => {
    folder = mkdtempSync(join(tmpdir(), "x-site-"));
    write("index.mdx", "---\ntitle: Home\n---\n");
    write("guides/b.md", "---\ntitle: B\n---\n");
    write("es/index.mdx", "---\ntitle: Inicio\n---\n");
    write("guides/notes.txt", "not a page");

    expect(list_content_files(folder)).toEqual(["es/index.mdx", "guides/b.md", "index.mdx"]);
    expect(read_content(folder, ["root", "es"]).map((page) => [page.id, page.locale, page.slug, page.frontmatter.title])).toEqual([
      ["es/index.mdx", "es", "", "Inicio"],
      ["guides/b.md", "root", "guides/b", "B"],
      ["index.mdx", "root", "", "Home"],
    ]);
  });

  it("refuses a page with no title", () => {
    folder = mkdtempSync(join(tmpdir(), "x-site-"));
    write("untitled.md", "Text");

    expect(() => read_content(folder, ["root"])).toThrow("untitled.md has no title");
  });
});
