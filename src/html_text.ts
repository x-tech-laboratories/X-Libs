// A web page's readable text: its title, then its words a block to a line, scripts, styles and drawings left out, and
// each link kept as plain text with its address after it. It needs nothing of Node or a page, so it runs anywhere.

// ── Entities ─────────────────────────────────────────────────────────────────

const named_entities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•",
  middot: "·", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", deg: "°", times: "×", divide: "÷", minus: "−",
};

// Character references such as &amp; and &#8217; as the characters they name.
export function unescape_html(text: string): string {
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);?/g, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
    }
    return named_entities[name] ?? named_entities[name.toLowerCase()] ?? whole;
  });
}

// ── Text ─────────────────────────────────────────────────────────────────────

const block_tags = new Set(["address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul"]);
const hidden_tags = new Set(["script", "style", "noscript", "svg", "template", "iframe", "object", "canvas"]);
// Read as they are up to their closing tag, since what is inside is not markup.
const raw_text_tags = new Set(["script", "style"]);

function attribute(attributes: string, name: string): string | null {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attributes);
  return found ? unescape_html(found[1] ?? found[2] ?? found[3] ?? "") : null;
}

// A link's address made whole against the page's, when it leads to another web page.
function link_address(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const address = new URL(href, base || undefined);
    return address.protocol === "http:" || address.protocol === "https:" ? address.href : null;
  } catch {
    return null;
  }
}

export interface PageText {
  title: string;
  text: string;
}

// The page's title and readable text; `base` is the page's address, which makes its relative links whole.
export function html_to_text(html: string, base = ""): PageText {
  const parts: string[] = [];
  const title_parts: string[] = [];
  let hidden = 0;
  let in_title = false;
  // Each open link: its address, and where its text starts among the parts.
  const links: { address: string | null; start: number }[] = [];
  const data = (raw: string, unescape = true) => {
    if (!raw || hidden) return;
    const text = unescape ? unescape_html(raw) : raw;
    if (in_title) title_parts.push(text);
    else parts.push(text);
  };
  const start_tag = (name: string, attributes: string) => {
    if (hidden_tags.has(name)) hidden += 1;
    if (hidden) return;
    if (name === "title") in_title = true;
    if (block_tags.has(name)) parts.push("\n");
    if (name === "a") links.push({ address: link_address(attribute(attributes, "href"), base), start: parts.length });
  };
  const end_tag = (name: string) => {
    if (hidden_tags.has(name) && hidden) {
      hidden -= 1;
      return;
    }
    if (hidden) return;
    if (name === "title") in_title = false;
    if (name === "a") {
      const link = links.pop();
      const said = link ? parts.slice(link.start).join("").replace(/\s+/g, " ").trim() : "";
      if (link?.address && said !== link.address) parts.push(said ? ` (${link.address})` : link.address);
    }
    if (block_tags.has(name)) parts.push("\n");
  };
  const tag = /<(\/?)([A-Za-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>/g;
  let position = 0;
  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    data(html.slice(position, match.index));
    position = tag.lastIndex;
    if (match[2] === undefined) continue;
    const name = match[2].toLowerCase();
    const attributes = match[3] ?? "";
    if (match[1]) {
      end_tag(name);
      continue;
    }
    start_tag(name, attributes);
    if (attributes.trimEnd().endsWith("/")) end_tag(name);
    else if (raw_text_tags.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, "ig");
      close.lastIndex = position;
      const end = close.exec(html);
      data(html.slice(position, end ? end.index : html.length), false);
      if (end) {
        end_tag(name);
        position = close.lastIndex;
      } else position = html.length;
      tag.lastIndex = position;
    }
  }
  data(html.slice(position));
  const words = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");
  const title = words(title_parts.join(" "));
  const lines = parts.join("").split(/\r\n|\r|\n/).map(words).filter(Boolean);
  return { title: Array.from(title).slice(0, 500).join(""), text: lines.join("\n") };
}
