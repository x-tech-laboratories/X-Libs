// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { as_code_block, code_fence } from "../src/web/markdown_text.ts";
import { RichText } from "../src/web/react/rich_text.tsx";
import "../src/web/react/test_stubs.ts";

afterEach(cleanup);

function text_box(): HTMLElement {
  return screen.getByRole("textbox", { name: "Notes" });
}

describe("code_fence", () => {
  test("outruns the longest backtick run in the text", () => {
    expect(code_fence("plain")).toBe("```");
    expect(code_fence("a ``` b")).toBe("````");
    expect(code_fence("`````")).toBe("``````");
  });

  test("as_code_block wraps the text between two fences", () => {
    expect(as_code_block("a\n```\nb")).toBe("````\na\n```\nb\n````");
  });
});

describe("RichText", () => {
  test("shows Markdown as formatted text", () => {
    render(<RichText label="Notes" value={"# Title\n\nSome **bold** text\n\n- [ ] milk"} on_change={() => {}} />);

    expect(text_box().querySelector("h1")?.textContent).toBe("Title");
    expect(text_box().querySelector("strong")?.textContent).toBe("bold");
    expect(text_box().querySelector('ul[data-type="taskList"]')).not.toBeNull();
  });

  test("keeps a fenced block's text exactly, backticks and Markdown signs included", () => {
    const kept = "* not a list\n# not a heading\n``` inner fence\n  indented <b>tag</b>";
    const on_change = vi.fn();
    render(<RichText label="Notes" value={"````\n" + kept + "\n````"} on_change={on_change} />);

    expect(text_box().querySelector("pre code")?.textContent).toBe(kept);
  });

  test("writes a code block back whole after an edit elsewhere", () => {
    const kept = "* a\n``` inner\nb";
    const on_change = vi.fn();
    render(<RichText label="Notes" value={"hello\n\n" + as_code_block(kept)} on_change={on_change} />);

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Heading" })); });

    expect(on_change).toHaveBeenLastCalledWith("## hello\n\n" + as_code_block(kept));
  });

  test("keeps blank lines at a code block's start and end", () => {
    const kept = "\n  first\n\nlast\n";
    const on_change = vi.fn();
    render(<RichText label="Notes" value={"hello\n\n" + as_code_block(kept)} on_change={on_change} />);

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Heading" })); });

    expect(text_box().querySelector("pre code")?.textContent).toBe(kept);
    expect(on_change).toHaveBeenLastCalledWith("## hello\n\n" + as_code_block(kept));
  });

  test("does not call on_change just for showing a value", () => {
    const on_change = vi.fn();
    const { rerender } = render(<RichText label="Notes" value="first" on_change={on_change} />);

    rerender(<RichText label="Notes" value="*second*" on_change={on_change} />);

    expect(text_box().querySelector("em")?.textContent).toBe("second");
    expect(on_change).not.toHaveBeenCalled();
  });

  test("does not call on_change when Tiptap only tidies the shown text", () => {
    const on_change = vi.fn();
    render(<RichText label="Notes" value={"See https://example.com\n\n" + as_code_block("old note")} on_change={on_change} />);

    fireEvent.focus(text_box());
    fireEvent.blur(text_box());

    expect(on_change).not.toHaveBeenCalled();
  });

  test("a toolbar button formats the text and reports the new Markdown", () => {
    const on_change = vi.fn();
    render(<RichText label="Notes" value="milk" on_change={on_change} />);

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Bulleted list" })); });

    expect(on_change).toHaveBeenLastCalledWith("- milk");
    expect(screen.getByRole("button", { name: "Bulleted list" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("calls on_blur when focus leaves the text", () => {
    const on_blur = vi.fn();
    render(<RichText label="Notes" value="milk" on_change={() => {}} on_blur={on_blur} />);

    fireEvent.focus(text_box());
    fireEvent.blur(text_box());

    expect(on_blur).toHaveBeenCalled();
  });
});
