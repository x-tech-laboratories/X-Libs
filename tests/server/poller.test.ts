import { afterEach, describe, expect, it, vi } from "vitest";
import { CyclePoller, type Watched } from "../../src/server/poller.ts";

function watched(id: string, busy = false): Watched & { cycles: boolean[] } {
  const cycles: boolean[] = [];
  return {
    id, cycles, settings: { interval: 60, job_poll: 5 }, busy: () => busy,
    cycle: async (options) => void cycles.push(options?.force_eval === true),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the poller", () => {
  it("cycles each item at start and again every interval, or every job_poll while it is busy", async () => {
    vi.useFakeTimers();
    const idle = watched("idle");
    const busy = watched("busy", true);
    const poller = new CyclePoller(() => [idle, busy]);

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    poller.stop();

    expect(idle.cycles.length).toBe(2);
    expect(busy.cycles.length).toBe(13);
  });

  it("cycles an idle item by its own idle interval and a busy one by its own poll interval, when it has them", async () => {
    vi.useFakeTimers();
    const idle = { ...watched("idle"), idle_interval: () => 10 };
    const busy = { ...watched("busy", true), poll_interval: () => 1 };
    const poller = new CyclePoller(() => [idle, busy]);

    poller.start();
    await vi.advanceTimersByTimeAsync(30_000);
    poller.stop();

    expect(idle.cycles.length).toBe(4);
    expect(busy.cycles.length).toBe(31);
  });

  it("refreshes with a forced cycle and polls soon after an action", async () => {
    vi.useFakeTimers();
    const item = watched("item");
    const poller = new CyclePoller(() => [item]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    await poller.refresh(item);
    poller.soon(item);
    await vi.advanceTimersByTimeAsync(2000);
    poller.stop();

    expect(item.cycles).toEqual([false, true, false]);
  });

  it("reports a failing cycle and keeps going, and starts nothing once stopped", async () => {
    vi.useFakeTimers();
    const failing: Watched = { ...watched("failing"), cycle: async () => { throw new Error("boom"); } };
    const errors: string[] = [];
    const poller = new CyclePoller(() => [failing], { error: (details) => void errors.push(details.id) });

    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    poller.stop();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(errors).toEqual(["failing", "failing"]);
  });
});
