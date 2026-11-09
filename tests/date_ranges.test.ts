import { describe, expect, test } from "vitest";

import { is_in_range, resolve_range } from "../src/date_ranges.ts";

// A Wednesday afternoon.
const now = new Date(2026, 10, 11, 14, 30);

// ── Ranges ───────────────────────────────────────────────────────────────────

describe("resolving a range", () => {
  test("snaps days to their first and last minutes", () => {
    const range = resolve_range({ start: { offset: 1, unit: "day" }, end: { offset: 1, unit: "day" } }, now);

    expect(range).toEqual({ first: "2026-11-12T00:00", last: "2026-11-12T23:59" });
  });

  test("runs earlier today from midnight to the current minute", () => {
    const range = resolve_range({ start: { offset: 0, unit: "day" }, end: { offset: 0, unit: "minute" } }, now);

    expect(range).toEqual({ first: "2026-11-11T00:00", last: "2026-11-11T14:30" });
  });

  test("starts weeks on Monday unless told otherwise", () => {
    const next_week = { start: { offset: 1, unit: "week" }, end: { offset: 1, unit: "week" } } as const;

    expect(resolve_range(next_week, now)).toEqual({ first: "2026-11-16T00:00", last: "2026-11-22T23:59" });
    expect(resolve_range(next_week, now, 0)).toEqual({ first: "2026-11-15T00:00", last: "2026-11-21T23:59" });
  });

  test("ends the rest of a month on its last day", () => {
    const range = resolve_range({ start: { offset: 0, unit: "day" }, end: { offset: 0, unit: "month" } }, now);

    expect(range).toEqual({ first: "2026-11-11T00:00", last: "2026-11-30T23:59" });
  });

  test("leaves a missing side open", () => {
    expect(resolve_range({ start: { offset: 1, unit: "month" }, end: null }, now)).toEqual({ first: "2026-12-01T00:00", last: null });
  });
});

// ── Matching ─────────────────────────────────────────────────────────────────

describe("matching a date", () => {
  const earlier_today = resolve_range({ start: { offset: 0, unit: "day" }, end: { offset: 0, unit: "minute" } }, now);
  const today = resolve_range({ start: { offset: 0, unit: "day" }, end: { offset: 0, unit: "day" } }, now);

  test("places a time by its minute", () => {
    expect(is_in_range("2026-11-11T09:00", earlier_today)).toBe(true);
    expect(is_in_range("2026-11-11T14:30", earlier_today)).toBe(true);
    expect(is_in_range("2026-11-11T14:31", earlier_today)).toBe(false);
  });

  test("places a plain date at the end of its day", () => {
    expect(is_in_range("2026-11-11", earlier_today)).toBe(false);
    expect(is_in_range("2026-11-11", today)).toBe(true);
  });

  test("lets an open side take everything", () => {
    expect(is_in_range("2099-01-01", { first: "2026-11-11T00:00", last: null })).toBe(true);
    expect(is_in_range("1999-01-01", { first: null, last: null })).toBe(true);
  });
});
