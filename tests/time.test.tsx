// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { use_now } from "../src/web/react/time.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Clock({ interval }: { interval?: number }) {
  return <span>{use_now(interval).toISOString()}</span>;
}

describe("use_now", () => {
  test("reads the time again each minute", () => {
    vi.useFakeTimers({ now: new Date("2026-06-10T23:59:30Z") });
    render(<Clock />);
    expect(screen.getByText("2026-06-10T23:59:30.000Z")).toBeTruthy();

    act(() => vi.advanceTimersByTime(60_000));

    expect(screen.getByText("2026-06-11T00:00:30.000Z")).toBeTruthy();
  });

  test("takes its own interval", () => {
    vi.useFakeTimers({ now: new Date("2026-06-10T09:00:00Z") });
    render(<Clock interval={1000} />);

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByText("2026-06-10T09:00:01.000Z")).toBeTruthy();
  });
});
