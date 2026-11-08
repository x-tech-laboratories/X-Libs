// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { Markdown, render_markdown } from "../src/web/react/markdown.tsx";

afterEach(cleanup);

describe("render_markdown", () => {
  test("turns headings, emphasis, code, lists and quotes into HTML", () => {
    const html = render_markdown("# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n> quoted");

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<blockquote>");
  });

  test("shows raw HTML as text and drops scripts and event handlers", () => {
    const html = render_markdown('Hello <b onclick="x()">there</b> <script>alert(1)</script>');

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b");
    expect(html).toContain("&lt;b onclick");
  });

  test("makes web links open in a new tab and leaves other schemes as text", () => {
    const html = render_markdown("[docs](https://example.com/docs) and [bad](javascript:alert(1))");

    expect(html).toContain('<a href="https://example.com/docs" target="_blank" rel="noreferrer">docs</a>');
    expect(html).not.toContain("<a href=\"javascript:");
    expect(html).toContain("bad (javascript:alert(1))");
  });
});

describe("Markdown", () => {
  test("draws the text as a markdown box", () => {
    render(<Markdown text="A *note*" class_name="answer" />);

    const box = screen.getByText("note").closest(".markdown")!;
    expect(box.className).toBe("markdown answer");
  });
});
