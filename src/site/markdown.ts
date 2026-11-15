// How a site's Markdown and MDX become pages, on MDX's own compiler: GitHub's tables, task lists, autolinks, alerts
// and raw HTML, frontmatter and a leading title heading kept out of the page, an id and an anchor link on every heading, code coloured by Shiki through Halon's
// tokens, and links within the site moved under its base.

import mdx from "@mdx-js/rollup";
import rehype_shiki from "@shikijs/rehype";
import type { Element, Root } from "hast";
import type { Blockquote, Heading, Root as MarkdownRoot } from "mdast";
import rehype_autolink_headings from "rehype-autolink-headings";
import rehype_raw from "rehype-raw";
import rehype_slug from "rehype-slug";
import remark_frontmatter from "remark-frontmatter";
import remark_gfm from "remark-gfm";
import { createCssVariablesTheme } from "shiki";
import { visit } from "unist-util-visit";
import type { Plugin } from "vite";
import { with_base } from "./model.ts";

// Colours each kind of code token with a --shiki-* variable that Halon's site sheet sets for the light and dark schemes.
const halon_code_theme = createCssVariablesTheme({ name: "halon", variablePrefix: "--shiki-", fontStyle: true });

interface JsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}

// Puts the base in front of every link and picture that starts at the site's root, written in Markdown or as a
// component's href or src.
export function rehype_base_links(base: string) {
  return (tree: Root): void => {
    if (base === "/") return;
    visit(tree, (node) => {
      if (node.type === "element") {
        const element = node as Element;
        for (const attribute of ["href", "src"]) {
          const value = element.properties[attribute];
          if (typeof value === "string") element.properties[attribute] = with_base(base, value);
        }
      } else if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
        for (const attribute of (node as unknown as { attributes: JsxAttribute[] }).attributes) {
          if (attribute.type === "mdxJsxAttribute" && (attribute.name === "href" || attribute.name === "src") && typeof attribute.value === "string") {
            attribute.value = with_base(base, attribute.value);
          }
        }
      }
    });
  };
}

const alert_kinds: Record<string, { type: string; label: string }> = {
  NOTE: { type: "note", label: "Note" },
  TIP: { type: "tip", label: "Tip" },
  IMPORTANT: { type: "note", label: "Important" },
  WARNING: { type: "caution", label: "Warning" },
  CAUTION: { type: "danger", label: "Caution" },
};

// GitHub's alerts, a quote opening with a marker such as [!TIP], drawn as the site's asides so they read the same on
// GitHub and on the site.
export function remark_github_alerts() {
  return (tree: MarkdownRoot): void => {
    visit(tree, "blockquote", (quote: Blockquote) => {
      const first = quote.children[0];
      const text = first?.type === "paragraph" ? first.children[0] : undefined;
      const marker = text?.type === "text" ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/.exec(text.value) : null;
      if (!marker || !text || text.type !== "text" || first.type !== "paragraph") return;
      const kind = alert_kinds[marker[1]];
      text.value = text.value.slice(marker[0].length);
      if (text.value === "") first.children.shift();
      if (first.children.length === 0) quote.children.shift();
      quote.children.unshift({ type: "paragraph", children: [{ type: "text", value: kind.label }], data: { hProperties: { className: ["site-aside-title"] } } });
      quote.data = { hName: "aside", hProperties: { className: ["site-aside"], dataType: kind.type } };
    });
  };
}

// A page's opening "# heading" is its title, which the site draws above the page, so it is not drawn twice; this lets
// a README with no frontmatter be a page as it is.
export function remark_drop_title_heading() {
  return (tree: MarkdownRoot): void => {
    const index = tree.children.findIndex((node) => !["yaml", "toml", "mdxjsEsm"].includes(node.type));
    const first = tree.children[index];
    if (first?.type === "heading" && (first as Heading).depth === 1) tree.children.splice(index, 1);
  };
}

// MDX's own nodes, which raw HTML parsing must pass through untouched.
const mdx_node_types = ["mdxFlowExpression", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxTextExpression", "mdxjsEsm"];

export function mdx_plugin(base: string): Plugin {
  return mdx({
    jsxImportSource: "react",
    remarkPlugins: [remark_frontmatter, remark_drop_title_heading, remark_gfm, remark_github_alerts],
    rehypePlugins: [
      [rehype_raw, { passThrough: mdx_node_types }],
      rehype_slug,
      [rehype_autolink_headings, { behavior: "append", properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1, dataPagefindIgnore: "" }, content: { type: "text", value: "#" } }],
      [rehype_shiki, { theme: halon_code_theme, defaultLanguage: "text", fallbackLanguage: "text" }],
      [rehype_base_links, base],
    ],
  }) as Plugin;
}
