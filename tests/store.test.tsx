// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { create_store, use_store } from "../src/web/react/store.ts";
import { coalesce_bumps, create_watch } from "../src/web/watch.ts";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("create_store", () => {
  test("holds a value, updates it from the current one, and bumps its watch", () => {
    const store = create_store(1);
    const seen = vi.fn();
    store.watch.subscribe(seen);

    store.set(2);
    store.update((current) => current + 10);

    expect(store.get()).toBe(12);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  test("a component reading it redraws when it changes", () => {
    const store = create_store("first");
    function Reader() { return <p>{use_store(store)}</p>; }
    render(<Reader />);

    act(() => store.set("second"));

    expect(screen.getByText("second")).toBeTruthy();
  });

  test("a coalesced store redraws at most once per interval", () => {
    vi.useFakeTimers();
    const store = create_store(0, { coalesce_in_milliseconds: 100 });
    const seen = vi.fn();
    store.watch.subscribe(seen);

    for (let token = 1; token <= 50; token++) store.set(token);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(50);
  });
});

describe("coalesce_bumps", () => {
  test("bumps at once when idle, then waits out the interval, and can be cancelled", () => {
    vi.useFakeTimers();
    const watch = create_watch();
    const bump = coalesce_bumps(watch, 150);

    bump();
    vi.advanceTimersByTime(0);
    expect(watch.version()).toBe(1);
    bump();
    bump();
    vi.advanceTimersByTime(149);
    expect(watch.version()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(watch.version()).toBe(2);

    bump();
    bump.cancel();
    vi.advanceTimersByTime(500);
    expect(watch.version()).toBe(2);
  });
});
