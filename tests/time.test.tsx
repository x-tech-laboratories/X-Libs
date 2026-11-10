// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { use_countdown, use_now } from "../src/web/react/time.tsx";

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

function Rest({ on_done }: { on_done: () => void }) {
  const timer = use_countdown(on_done);
  const countdown = timer.countdown;
  return (
    <div>
      <output>{countdown ? `${countdown.remaining} of ${countdown.total}${countdown.ends_at ? "" : " paused"}` : "idle"}</output>
      <button type="button" onClick={() => timer.start(60)}>Start</button>
      <button type="button" onClick={timer.pause}>Pause</button>
      <button type="button" onClick={timer.resume}>Resume</button>
      <button type="button" onClick={() => timer.extend(30)}>+30s</button>
      <button type="button" onClick={timer.stop}>Stop</button>
    </div>
  );
}

function shown(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("use_countdown", () => {
  test("counts down by the clock and runs on_done once at zero", () => {
    vi.useFakeTimers({ now: new Date("2026-06-10T09:00:00Z") });
    const on_done = vi.fn();
    render(<Rest on_done={on_done} />);
    expect(shown()).toBe("idle");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(shown()).toBe("50 of 60");

    act(() => vi.advanceTimersByTime(50_000));
    expect(on_done).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("idle");
    act(() => vi.advanceTimersByTime(5_000));
    expect(on_done).toHaveBeenCalledTimes(1);
  });

  test("shows the time really left after the page slept", () => {
    vi.useFakeTimers({ now: new Date("2026-06-10T09:00:00Z") });
    render(<Rest on_done={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // The clock moves on without the timers firing, as on a phone that slept.
    vi.setSystemTime(new Date("2026-06-10T09:00:45Z"));
    act(() => vi.advanceTimersByTime(200));

    expect(shown()).toBe("15 of 60");
  });

  test("pauses, resumes where it stopped, and extends", () => {
    vi.useFakeTimers({ now: new Date("2026-06-10T09:00:00Z") });
    const on_done = vi.fn();
    render(<Rest on_done={on_done} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => vi.advanceTimersByTime(20_000));

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => vi.advanceTimersByTime(120_000));
    expect(shown()).toBe("40 of 60 paused");
    expect(on_done).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "+30s" }));
    expect(shown()).toBe("70 of 90 paused");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(shown()).toBe("60 of 90");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(shown()).toBe("idle");
    expect(on_done).not.toHaveBeenCalled();
  });
});
