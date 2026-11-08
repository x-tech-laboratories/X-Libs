// Markdown drawn as safe HTML on marked and DOMPurify: raw HTML shows as text, only web links are clickable, and they open in a new tab.
// marked matches the hand-written parser feature for feature (headings, lists, code, quotes, rules, emphasis, links) and adds tables and nested lists; DOMPurify drops anything a model might slip in.

import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";
import { useLayoutEffect, useMemo, useRef } from "react";
import { cx } from "../dom.ts";
import { at_bottom } from "./following.tsx";

const LINK_SCHEMES = ["http://", "https://"];

const escape_html = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const renderer = {
  // Raw HTML in the text shows as written.
  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escape_html(text);
  },
  // Only web links become links; another scheme shows as its text and address.
  link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, { href, title, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    if (!LINK_SCHEMES.some((scheme) => href.startsWith(scheme))) return `${text} (${escape_html(href)})`;
    const title_part = title ? ` title="${escape_html(title)}"` : "";
    return `<a href="${escape_html(href)}"${title_part} target="_blank" rel="noreferrer">${text}</a>`;
  },
};

const marked = new Marked({ gfm: true, breaks: true, renderer });

// Markdown as sanitized HTML, ready for innerHTML.
export function render_markdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
}

interface MarkdownProps {
  text: string;
  class_name?: string;
  // Keeps the newest text in view as it streams in, unless the reader has scrolled up.
  follow?: boolean;
}

export function Markdown({ text, class_name, follow = false }: MarkdownProps) {
  const box = useRef<HTMLDivElement>(null);
  const html = useMemo(() => render_markdown(text), [text]);
  const following = follow && (box.current === null || at_bottom(box.current));

  useLayoutEffect(() => {
    if (following && box.current !== null) box.current.scrollTop = box.current.scrollHeight;
  }, [html]);

  return <div ref={box} className={cx("markdown", class_name)} dangerouslySetInnerHTML={{ __html: html }} />;
}
