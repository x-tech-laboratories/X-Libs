import { describe, expect, it } from "vitest";

import { html_to_text, unescape_html } from "../src/html_text.ts";

describe("a page's readable text", () => {
  it("is its title, then a block to a line, links as plain text with their addresses, scripts and styles left out", () => {
    const page = html_to_text(
      `<html><head><title>Tiles &amp; grout</title><style>p{color:red}</style><script>alert("<p>x</p>")</script></head>
       <body><h1>Laying tiles</h1><p>Start <b>from</b> the middle.<br>Use <a href="/spacers">spacers</a> and <a href="https://example.org/grout">https://example.org/grout</a>.</p>
       <ul><li>One</li><li>Two &#8217;s</li></ul><!-- hidden --><svg><text>drawing</text></svg><a href="mailto:a@b.c">mail</a><a href="/empty"></a></body></html>`,
      "https://tiles.example/guide/",
    );
    expect(page.title).toBe("Tiles & grout");
    expect(page.text).toBe(["Laying tiles", "Start from the middle.", "Use spacers (https://tiles.example/spacers) and https://example.org/grout.", "One", "Two ’s", "mailhttps://tiles.example/empty"].join("\n"));
    expect(unescape_html("&lt;&#x41;&#0;&unknown;&NBSP;")).toBe("<A�&unknown; ");
    expect(html_to_text("<p>Unclosed <script>never closed").text).toBe("Unclosed");
  });

  it("leaves a relative link without a base, and a self-closed tag, as text alone", () => {
    expect(html_to_text(`<p>See <a href='/x'>this</a><br/>next <a href=https://a.example/x>here</a></p>`).text).toBe("See this\nnext here (https://a.example/x)");
    expect(html_to_text("<title>" + "t".repeat(600) + "</title>").title).toHaveLength(500);
  });
});
