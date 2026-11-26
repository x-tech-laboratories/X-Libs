import { describe, expect, it } from "vitest";
import { AttemptLimit } from "../../src/server/attempt_limit.ts";

describe("attempt limit", () => {
  it("lets a key try as often as allowed in a window, then says how long to wait", () => {
    let now = 0;
    const limit = new AttemptLimit({ tries_allowed: 2, window_seconds: 60, now: () => now });

    expect(limit.take("address")).toBe(0);
    expect(limit.take("address")).toBe(0);
    now = 10_500;
    expect(limit.take("address")).toBe(50);
    expect(limit.take("other")).toBe(0);
    now = 60_000;
    expect(limit.take("address")).toBe(0);
  });

  it("does not count a try that was given back", () => {
    const limit = new AttemptLimit({ tries_allowed: 1, window_seconds: 60 });

    expect(limit.take("address")).toBe(0);
    limit.give_back("address");
    limit.give_back("address");
    limit.give_back("never seen");

    expect(limit.take("address")).toBe(0);
    expect(limit.take("address")).toBeGreaterThan(0);
  });

  it("forgets ended windows, then the oldest, to keep to its most keys", () => {
    let now = 0;
    const limit = new AttemptLimit({ tries_allowed: 1, window_seconds: 60, most_keys: 2, now: () => now });

    limit.take("first");
    now = 30_000;
    limit.take("second");
    limit.take("third");
    expect(limit.take("first")).toBe(0);

    now = 200_000;
    limit.take("fourth");
    limit.take("fifth");
    expect(limit.take("fourth")).toBeGreaterThan(0);
  });
});
