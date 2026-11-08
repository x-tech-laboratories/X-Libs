// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { use_reveal } from "../src/web/react/reveal.ts";

// Stands in for the browser's IntersectionObserver, which jsdom lacks, and lets a test scroll the marker into view.
class FakeObserver {
  static all: FakeObserver[] = [];
  watched = new Set<Element>();
  options: IntersectionObserverInit | undefined;
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeObserver.all.push(this);
  }

  observe(element: Element) { this.watched.add(element); }
  unobserve(element: Element) { this.watched.delete(element); }
  disconnect() { this.watched.clear(); }

  static scroll_into_view() {
    for (const observer of FakeObserver.all) {
      const entries = [...observer.watched].map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
      if (entries.length) observer.callback(entries, observer as unknown as IntersectionObserver);
    }
  }
}

const items = Array.from({ length: 25 }, (_, index) => `Video ${index + 1}`);

function List() {
  const { shown_count, more_ref, reset } = use_reveal(10, { root_margin: "100px" });
  return (
    <>
      <ul>{items.slice(0, shown_count).map((item) => <li key={item}>{item}</li>)}</ul>
      {shown_count < items.length && <div ref={more_ref} />}
      <button onClick={reset}>Back to the top</button>
    </>
  );
}

beforeEach(() => {
  FakeObserver.all = [];
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
});

afterEach(cleanup);

describe("use_reveal", () => {
  it("shows the first page, and the next each time the end comes into view", () => {
    render(<List />);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(FakeObserver.all[0]!.options).toEqual({ rootMargin: "100px" });

    act(() => FakeObserver.scroll_into_view());
    expect(screen.getAllByRole("listitem")).toHaveLength(20);

    act(() => FakeObserver.scroll_into_view());
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
  });

  it("stops watching once the whole list shows, and goes back to the first page on reset", () => {
    render(<List />);
    act(() => FakeObserver.scroll_into_view());
    act(() => FakeObserver.scroll_into_view());

    expect(FakeObserver.all.every((observer) => observer.watched.size === 0)).toBe(true);

    act(() => screen.getByRole("button", { name: "Back to the top" }).click());
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("starts from the count it is given, such as the one shown before the page was left", () => {
    function Returning() {
      const { shown_count } = use_reveal(10, { initial_count: 20 });
      return <ul>{items.slice(0, shown_count).map((item) => <li key={item}>{item}</li>)}</ul>;
    }
    render(<Returning />);

    expect(screen.getAllByRole("listitem")).toHaveLength(20);
  });
});
