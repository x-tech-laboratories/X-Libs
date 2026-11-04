import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { age, bytes, count_change, duration, plural, size, size_change, until } from "../src/web/format.ts";

const now = 1_800_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatting", () => {
  it("writes how long ago and how long until", () => {
    expect(age(null)).toBe("never");
    expect(age(now - 30)).toBe("30s ago");
    expect(age(now - 3 * 3600)).toBe("3h ago");
    expect(until(now + 3 * 86400)).toBe("in 3d");
    expect(until(now - 120)).toBe("2m ago");
    expect(until(null)).toBe("—");
  });

  it("writes durations short", () => {
    expect(duration(45)).toBe("45s");
    expect(duration(600)).toBe("10m");
    expect(duration(9000)).toBe("2.5h");
    expect(duration(7 * 86400)).toBe("7d");
  });

  it("writes sizes in binary and decimal units", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(44.4 * 1024 ** 3)).toBe("44.4 GiB");
    expect(size(1_200_000_000)).toBe("1.2 GB");
    expect(size_change(-300_000_000)).toBe("−300 MB");
    expect(size_change(1_200_000_000)).toBe("+1.2 GB");
    expect(size(undefined)).toBe("—");
  });

  it("writes counts", () => {
    expect(count_change(3)).toBe("+3");
    expect(count_change(-3)).toBe("−3");
    expect(count_change(0)).toBe("0");
    expect(plural(1, "host")).toBe("1 host");
    expect(plural(2, "host")).toBe("2 hosts");
  });
});
