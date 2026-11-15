// How a site's Markdown and MDX become pages, on MDX's own compiler: GitHub's tables, task lists and autolinks,
// frontmatter kept out of the page, an id and an anchor link on every heading, code coloured by Shiki through Halon's
// tokens, and links within the site moved under its base.

import mdx from "@mdx-js/rollup";
import rehype_shiki from "@shikijs/rehype";
import type { Element, Root } from "hast";
import rehype_autolink_headings from "rehype-autolink-headings";
import rehype_slug from "rehype-slug";
import remark_frontmatter from "remark-frontmatter";
import remark_gfm from "remark-gfm";
import { createCssVariablesTheme } from "shiki";
import { visit } from "unist-util-visit";
import type { Plugin } from "vite";
import { with_base } from "./model.ts";

// Colours each kind of code token with a --shiki-* variable that Halon's site sheet sets for the light and dark schemes.
const halon_code_theme = createCssVariablesTheme({ name: "halon", variablePrefix: "--shiki-", fontStyle: true });

// Puts the base in front of every link and picture that starts at the site's root.
export function rehype_base_links(base: string) {
  return (tree: Root): void => {
    if (base === "/") return;
    visit(tree, "element", (element: Element) => {
      for (const attribute of ["href", "src"]) {
        const value = element.properties[attribute];
        if (typeof value === "string") element.properties[attribute] = with_base(base, value);
      }
    });
  };
}

export function mdx_plugin(base: string): Plugin {
  return mdx({
    jsxImportSource: "react",
    remarkPlugins: [remark_frontmatter, remark_gfm],
    rehypePlugins: [
      rehype_slug,
      [rehype_autolink_headings, { behavior: "append", properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1, dataPagefindIgnore: "" }, content: { type: "text", value: "#" } }],
      [rehype_shiki, { theme: halon_code_theme, defaultLanguage: "text", fallbackLanguage: "text" }],
      [rehype_base_links, base],
    ],
  }) as Plugin;
}
