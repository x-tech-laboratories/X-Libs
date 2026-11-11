import { afterEach, describe, expect, it, vi } from "vitest";

import { leading_cooldown } from "../../src/server/events.ts";
import { Leases } from "../../src/server/leases.ts";

afterEach(() => vi.useRealTimers());

describe("leases", () => {
  it("end when closed, once, and not after", () => {
    const leases = new Leases(30);
    const ended: string[] = [];
    const lease = leases.open(() => void ended.push("job"), "7");
    expect(lease).toBe("7-1");
    expect(leases.size).toBe(1);
    leases.close(lease);
    leases.close(lease);
    expect(ended).toEqual(["job"]);
    expect(leases.renew(lease)).toBe(false);
  });

  it("run out unless renewed", () => {
    vi.useFakeTimers();
    const leases = new Leases(30);
    let ended = 0;
    const lease = leases.open(() => void (ended += 1));
    vi.advanceTimersByTime(29_000);
    expect(leases.renew(lease)).toBe(true);
    vi.advanceTimersByTime(29_000);
    expect(ended).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(ended).toBe(1);
    expect(leases.size).toBe(0);
  });

  it("all end together", () => {
    const leases = new Leases();
    let ended = 0;
    leases.open(() => void (ended += 1));
    leases.open(() => void (ended += 1));
    leases.close_all();
    expect([ended, leases.size]).toEqual([2, 0]);
  });
});

describe("the leading cooldown", () => {
  it("flushes the first change at once and a burst once more when it cools", () => {
    vi.useFakeTimers();
    let pending = 0;
    const sent: number[] = [];
    const cooldown = leading_cooldown(500, () => {
      if (pending === 0) return false;
      sent.push(pending);
      pending = 0;
      return true;
    });
    pending += 1;
    cooldown.poke();
    for (let index = 0; index < 5; index += 1) {
      pending += 1;
      cooldown.poke();
    }
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1, 5]);
    vi.advanceTimersByTime(500);
    pending += 1;
    cooldown.poke();
    expect(sent).toEqual([1, 5, 1]);
    cooldown.stop();
  });
});
