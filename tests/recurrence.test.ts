import { describe, expect, test } from "vitest";

import {
  describe_rule, format_recurrence, format_rule, from_rule_date, next_from_now, next_occurrence, ordinal_word, parse_ical_date, parse_recurrence, parse_rule, parse_rule_part, rule_calendar,
  to_rule_date,
} from "../src/recurrence.ts";

// ── Rules ────────────────────────────────────────────────────────────────────

describe("rules", () => {
  test("reads every BY part as a list and writes the rule back with FREQ and INTERVAL first", () => {
    const options = parse_rule("BYDAY=MO,WE;FREQ=WEEKLY;COUNT=10;INTERVAL=2");

    expect(options.byweekday?.map(String)).toEqual(["MO", "WE"]);
    expect(options.count).toBe(10);
    expect(format_rule(options)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10");
  });

  test("takes a rule with its RRULE: prefix and leaves out an interval of one", () => {
    expect(format_rule(parse_rule("RRULE:FREQ=DAILY;INTERVAL=1"))).toBe("FREQ=DAILY");
  });

  test("refuses text without a FREQ part", () => {
    expect(() => parse_rule("BYDAY=MO")).toThrow("no FREQ");
  });

  test("keeps parts it does not know, with an RSCALE calendar first", () => {
    const options = parse_rule("RSCALE=HEBREW;FREQ=YEARLY;X-NAME=thing;BYMONTH=5");

    expect(options.extra_parts).toEqual(["RSCALE=HEBREW", "X-NAME=thing"]);
    expect(format_rule(options)).toBe("RSCALE=HEBREW;FREQ=YEARLY;BYMONTH=5;X-NAME=thing");
    expect(rule_calendar(options)).toBe("RSCALE=HEBREW");
    expect(rule_calendar(parse_rule("RSCALE=GREGORIAN;FREQ=DAILY"))).toBe("");
  });

  test("writes UNTIL to match the event's start", () => {
    const options = parse_rule("FREQ=DAILY;UNTIL=20261231T235900Z");

    expect(format_rule(options)).toBe("FREQ=DAILY;UNTIL=20261231T235900Z");
    expect(format_rule(options, "floating")).toBe("FREQ=DAILY;UNTIL=20261231T235900");
    expect(format_rule(options, { all_day: true })).toBe("FREQ=DAILY;UNTIL=20261231");
  });

  test("reads a BY part's list and names the values it allows", () => {
    expect(parse_rule_part("bymonthday", "15, -1")).toEqual([15, -1]);
    expect(parse_rule_part("byweekday", "MO -1fr").map(String)).toEqual(["MO", "-1FR"]);
    expect(() => parse_rule_part("bymonth", "13")).toThrow('BYMONTH takes whole numbers from 1 to 12, not "13".');
    expect(() => parse_rule_part("byhour", "-1")).toThrow("BYHOUR");
    expect(() => parse_rule_part("bymonthday", "0")).toThrow("from -31 to -1 and 1 to 31");
    expect(() => parse_rule_part("byweekday", "XX")).toThrow("BYDAY takes weekdays");
  });

  test("names positions in English", () => {
    expect([1, -1, -2, 12, 21, 22, 23, 111, -7].map(ordinal_word)).toEqual(["first", "last", "second last", "12th", "21st", "22nd", "23rd", "111th", "7th last"]);
  });
});

// ── Recurrence sets ──────────────────────────────────────────────────────────

describe("recurrence lines", () => {
  test("reads RRULE, EXDATE and RDATE lines, unfolding long ones, and keeps TZID lines as written", () => {
    const text = "RRULE:FREQ=WEEKLY;\n BYDAY=MO\nEXDATE;VALUE=DATE:20260105,20260112\nRDATE:20260107T090000Z\nEXDATE;TZID=Europe/Paris:20260119T090000";
    const recurrence = parse_recurrence(text);

    expect(format_rule(recurrence.rule!)).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(recurrence.exdates.map((date) => date.ical_kind)).toEqual(["date", "date"]);
    expect(recurrence.rdates[0]?.toISOString()).toBe("2026-01-07T09:00:00.000Z");
    expect(recurrence.extra_lines).toEqual(["EXDATE;TZID=Europe/Paris:20260119T090000"]);
    expect(format_recurrence(recurrence)).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE;VALUE=DATE:20260105,20260112\nRDATE:20260107T090000Z\nEXDATE;TZID=Europe/Paris:20260119T090000");
  });

  test("writes new dates in the format's kind", () => {
    const date = new Date(Date.UTC(2026, 0, 5, 9, 30));
    const recurrence = { rule: parse_rule("FREQ=DAILY"), exdates: [date], rdates: [], extra_lines: [] };

    expect(format_recurrence(recurrence)).toBe("RRULE:FREQ=DAILY\nEXDATE:20260105T093000Z");
    expect(format_recurrence(recurrence, "floating")).toBe("RRULE:FREQ=DAILY\nEXDATE:20260105T093000");
    expect(format_recurrence(recurrence, { all_day: true })).toBe("RRULE:FREQ=DAILY\nEXDATE;VALUE=DATE:20260105");
  });

  test("needs a rule or extra dates", () => {
    expect(() => parse_recurrence("EXDATE:20260105T093000Z")).toThrow("no RRULE or RDATE");
    expect(parse_recurrence("RDATE:20260105T093000Z").rule).toBeNull();
    expect(() => parse_ical_date("2026-01-05")).toThrow("not an iCalendar date");
  });
});

// ── Dates ────────────────────────────────────────────────────────────────────

describe("rule dates", () => {
  test("turns a local clock into UTC fields for floating rules and back", () => {
    const local = new Date(2026, 5, 10, 9, 30);
    const rule_date = to_rule_date(local, "floating");

    expect(rule_date.toISOString()).toBe("2026-06-10T09:30:00.000Z");
    expect(from_rule_date(rule_date, "floating")).toEqual(local);
    expect(to_rule_date(local, { all_day: true }).toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect(to_rule_date(local)).toEqual(local);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

describe("helpers", () => {
  test("describes a rule in English with its times, positions, end and dates", () => {
    expect(describe_rule("FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9,17;BYMINUTE=0")).toBe("Every week on Monday, Wednesday at 09:00 and 17:00");
    expect(describe_rule("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3")).toBe("Every month on weekdays, only the last of those for 3 times");
    expect(describe_rule("FREQ=HOURLY;BYMINUTE=0,30")).toBe("Every hour at 0 and 30 minutes past the hour");
    expect(describe_rule("FREQ=DAILY;UNTIL=20261231", { all_day: true })).toBe("Every day until December 31, 2026");
    expect(describe_rule("RRULE:FREQ=DAILY\nEXDATE:20260105T093000Z\nRDATE:20260107T090000Z")).toBe("Every day, except 1 date, plus 1 other date");
  });

  test("describes nothing it cannot put in English", () => {
    expect(describe_rule("")).toBe("");
    expect(describe_rule("nonsense")).toBe("");
    expect(describe_rule("RSCALE=HEBREW;FREQ=YEARLY")).toBe("");
  });

  test("finds the next occurrence and lowers COUNT in the value to keep", () => {
    const start = new Date(Date.UTC(2026, 0, 5, 9)); // a Monday
    const next = next_occurrence("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3", start);

    expect(next?.next_date.toISOString()).toBe("2026-01-07T09:00:00.000Z");
    expect(next?.rule).toBe("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=2");
    expect(next_occurrence("FREQ=DAILY;COUNT=1", start)).toBeNull();
  });

  test("skips EXDATE and keeps the lines when the value has them", () => {
    const start = new Date(Date.UTC(2026, 0, 5, 9));
    const next = next_occurrence("RRULE:FREQ=DAILY\nEXDATE:20260106T090000Z", start);

    expect(next?.next_date.toISOString()).toBe("2026-01-07T09:00:00.000Z");
    expect(next?.rule).toBe("RRULE:FREQ=DAILY\nEXDATE:20260106T090000Z");
  });

  test("counts from the start of the current minute", () => {
    const now = new Date(Date.UTC(2026, 0, 5, 9, 0, 30));

    expect(next_from_now("FREQ=MINUTELY", "utc", now)?.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  test("refuses to calculate an RSCALE calendar", () => {
    expect(() => next_occurrence("RSCALE=HEBREW;FREQ=YEARLY", new Date())).toThrow("cannot calculate RSCALE=HEBREW");
  });
});
