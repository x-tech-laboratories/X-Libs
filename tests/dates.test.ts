import { describe, expect, test } from "vitest";

import {
  add_days, add_months, days_between, format_local, format_month, has_time, is_day, is_month, is_overdue, month_of, months_from, parse_local, relative_day_label,
  shift_day, shift_month, start_of_day, this_month, today,
} from "../src/dates.ts";

// ── Text and dates ───────────────────────────────────────────────────────────

describe("local date text", () => {
  test("reads a plain date as local midnight", () => {
    expect(parse_local("2026-03-14")).toEqual(new Date(2026, 2, 14, 0, 0));
  });

  test("reads a date with a time", () => {
    expect(parse_local("2026-03-14T09:05")).toEqual(new Date(2026, 2, 14, 9, 5));
  });

  test("writes a date back with or without its time", () => {
    const date = new Date(2026, 0, 2, 7, 3);

    expect(format_local(date, false)).toBe("2026-01-02");
    expect(format_local(date, true)).toBe("2026-01-02T07:03");
  });

  test("tells a time from a plain date", () => {
    expect(has_time("2026-03-14T09:05")).toBe(true);
    expect(has_time("2026-03-14")).toBe(false);
  });
});

// ── Arithmetic ───────────────────────────────────────────────────────────────

describe("date arithmetic", () => {
  test("starts the day at midnight", () => {
    expect(start_of_day(new Date(2026, 4, 5, 23, 59))).toEqual(new Date(2026, 4, 5));
  });

  test("counts calendar days whatever the hour", () => {
    expect(days_between(new Date(2026, 4, 5, 23, 0), new Date(2026, 4, 6, 1, 0))).toBe(1);
    expect(days_between(new Date(2026, 4, 6), new Date(2026, 4, 1))).toBe(-5);
  });

  test("adds days across a month end", () => {
    expect(add_days(new Date(2026, 0, 30, 8, 0), 3)).toEqual(new Date(2026, 1, 2, 8, 0));
  });

  test("adds months, falling back to the month's last day", () => {
    expect(add_months(new Date(2026, 0, 31, 10, 30), 1)).toEqual(new Date(2026, 1, 28, 10, 30));
    expect(add_months(new Date(2028, 0, 31), 1)).toEqual(new Date(2028, 1, 29));
    expect(add_months(new Date(2026, 2, 31), -1)).toEqual(new Date(2026, 1, 28));
    expect(add_months(new Date(2026, 10, 15), 3)).toEqual(new Date(2027, 1, 15));
  });
});

// ── Labels ───────────────────────────────────────────────────────────────────

describe("overdue and labels", () => {
  const now = new Date(2026, 5, 10, 12, 0);

  test("a plain date is overdue only once its day has passed", () => {
    expect(is_overdue("2026-06-10", now)).toBe(false);
    expect(is_overdue("2026-06-09", now)).toBe(true);
  });

  test("a date with a time is overdue once the time has passed", () => {
    expect(is_overdue("2026-06-10T11:59", now)).toBe(true);
    expect(is_overdue("2026-06-10T12:01", now)).toBe(false);
  });

  test("names the nearby days", () => {
    expect(relative_day_label("2026-06-09", now, "en-US")).toBe("Yesterday");
    expect(relative_day_label("2026-06-10", now, "en-US")).toBe("Today");
    expect(relative_day_label("2026-06-11", now, "en-US")).toBe("Tomorrow");
  });

  test("gives other days as a short date, with the year only when it differs", () => {
    expect(relative_day_label("2026-06-20", now, "en-US")).toBe("Jun 20");
    expect(relative_day_label("2027-01-03", now, "en-US")).toBe("Jan 3, 2027");
  });

  test("adds the time when there is one", () => {
    expect(relative_day_label("2026-06-11T09:30", now, "en-US")).toMatch(/^Tomorrow 9:30\sAM$/);
  });
});

// ── Days and months ──────────────────────────────────────────────────────────

describe("days and months", () => {
  const now = new Date(2026, 0, 31, 23, 30);

  test("names today and this month on the device's clock", () => {
    expect(today(now)).toBe("2026-01-31");
    expect(this_month(now)).toBe("2026-01");
  });

  test("steps days across a month's end", () => {
    expect(shift_day("2026-01-31", 1)).toBe("2026-02-01");
    expect(shift_day("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("takes the month from the text and steps it across years", () => {
    expect(month_of("2026-08-01")).toBe("2026-08");
    expect(shift_month("2026-01", -1)).toBe("2025-12");
    expect(shift_month("2026-11", 14)).toBe("2028-01");
    expect(months_from("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(months_from("2026-02", "2026-01")).toEqual([]);
  });

  test("tells real days and months from other text", () => {
    expect(is_day("2024-02-29")).toBe(true);
    expect(is_day("2026-02-30")).toBe(false);
    expect(is_day("2026-02-03T10:00")).toBe(false);
    expect(is_month("2026-12")).toBe(true);
    expect(is_month("2026-13")).toBe(false);
    expect(is_month(202612)).toBe(false);
  });

  test("names a month in words", () => {
    expect(format_month("2026-06", "en-US")).toBe("June 2026");
    expect(format_month("2026-06", "en-US", true)).toBe("Jun 2026");
  });
});
