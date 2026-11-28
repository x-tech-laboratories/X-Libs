import { describe, expect, it } from "vitest";

import { CronSchedule, checked_schedule, describe_schedule, is_due, next_due, schedule_cron } from "../src/cron.ts";

describe("CronSchedule", () => {
  it("runs a daily time next at that time, and strictly after the moment given", () => {
    const cron = CronSchedule.parse("30 2 * * *");
    expect(cron.next_after(new Date(2026, 9, 21, 1, 0))).toEqual(new Date(2026, 9, 21, 2, 30));
    expect(cron.next_after(new Date(2026, 9, 21, 2, 30))).toEqual(new Date(2026, 9, 22, 2, 30));
  });

  it("reads steps, ranges and lists", () => {
    const cron = CronSchedule.parse("*/15 9-17 * * 1-5");
    expect([...cron.minutes]).toEqual([0, 15, 30, 45]);
    expect([...cron.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(cron.next_after(new Date(2026, 9, 23, 17, 50))).toEqual(new Date(2026, 9, 26, 9, 0));
  });

  it("runs a lone value with a step to the end of its range", () => {
    expect([...CronSchedule.parse("5/20 * * * *").minutes]).toEqual([5, 25, 45]);
  });

  it("reads month and weekday names, and 7 as Sunday", () => {
    expect([...CronSchedule.parse("0 0 * jan,JUL sun").months]).toEqual([1, 7]);
    expect([...CronSchedule.parse("0 0 * * 7").weekdays]).toEqual([0]);
  });

  it("reads the aliases", () => {
    expect(CronSchedule.parse("@weekly").next_after(new Date(2026, 9, 21, 12, 0))).toEqual(new Date(2026, 9, 25, 0, 0));
    expect(CronSchedule.parse("@Daily").expression).toBe("@Daily");
  });

  it("matches either a restricted day of month or a restricted weekday, as cron does", () => {
    const cron = CronSchedule.parse("0 0 1 * mon");
    expect(cron.next_after(new Date(2026, 9, 21))).toEqual(new Date(2026, 9, 26));
    expect(cron.next_after(new Date(2026, 9, 27))).toEqual(new Date(2026, 10, 1));
  });

  it("finds a leap day years away", () => {
    expect(CronSchedule.parse("0 0 29 2 *").next_after(new Date(2026, 2, 1))).toEqual(new Date(2028, 1, 29));
  });

  it.each(["* * * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "5-1 * * * *", "0 0 30 2 *", "x * * * *"])(
    "refuses %s",
    (expression) => {
      expect(() => CronSchedule.parse(expression)).toThrow(Error);
    },
  );
});

describe("run schedules", () => {
  const hour = 3_600_000;

  it("are checked and said in plain words", () => {
    expect(describe_schedule(checked_schedule({ kind: "every", every: 2, unit: "hours" }))).toBe("every 2 hours");
    expect(describe_schedule(checked_schedule({ kind: "every", every: 1, unit: "days" }))).toBe("every day");
    expect(describe_schedule(checked_schedule({ kind: "at", time: "7:30", weekdays: [5, 1, 1] }))).toBe("at 07:30 on Monday and Friday");
    expect(describe_schedule(checked_schedule({ kind: "at", time: "7:30", weekdays: [3] }))).toBe("at 07:30 on Wednesday");
    expect(describe_schedule(checked_schedule({ kind: "at", time: "18:00", weekdays: [1, 2, 3, 4, 5] }))).toBe("at 18:00 on weekdays");
    expect(describe_schedule(checked_schedule({ kind: "at", time: "18:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }))).toBe("at 18:00 every day");
    expect(() => checked_schedule({ kind: "every", every: 2, unit: "weeks" })).toThrow("unit is");
    expect(() => checked_schedule({ kind: "every", every: 2, unit: "constructor" })).toThrow("unit is");
    expect(checked_schedule({ kind: "every", every: 1, unit: "minutes" })).toEqual({ kind: "every", every: 1, unit: "minutes" });
    expect(() => checked_schedule({ kind: "every", every: 1, unit: "minutes" }, { min_minutes: 5 })).toThrow("A schedule runs at most every 5 minutes.");
    expect(() => checked_schedule({ kind: "every", every: 1.5, unit: "hours" })).toThrow("whole number");
    expect(() => checked_schedule({ kind: "at", time: "25:00", weekdays: [1] })).toThrow("24-hour time");
    expect(() => checked_schedule({ kind: "at", time: "07:00", weekdays: [] })).toThrow("one weekday or more");
    expect(() => checked_schedule({ kind: "at", time: "07:00" })).toThrow("one weekday or more");
    expect(() => checked_schedule(null)).toThrow("A schedule is");
  });

  it("fall due once however many times they were missed", () => {
    const every = checked_schedule({ kind: "every", every: 2, unit: "hours" });
    const since = new Date(2026, 10, 26, 9).getTime();
    expect(is_due(every, since, since + hour)).toBe(false);
    expect(is_due(every, since, since + 2 * hour)).toBe(true);
    expect(is_due(every, since, since + 20 * hour)).toBe(true);
    expect(next_due(every, since)).toBe(since + 2 * hour);

    // 2026-11-26 is a Thursday.
    const thursdays = checked_schedule({ kind: "at", time: "08:00", weekdays: [4] });
    expect(thursdays.kind === "at" && schedule_cron(thursdays).expression).toBe("0 8 * * 4");
    expect(is_due(thursdays, new Date(2026, 10, 26, 7).getTime(), new Date(2026, 10, 26, 7, 59).getTime())).toBe(false);
    expect(is_due(thursdays, new Date(2026, 10, 26, 7).getTime(), new Date(2026, 10, 26, 8).getTime())).toBe(true);
    expect(is_due(thursdays, new Date(2026, 10, 26, 8).getTime(), new Date(2026, 10, 27, 12).getTime())).toBe(false);
    expect(is_due(thursdays, new Date(2026, 10, 10, 8, 30).getTime(), new Date(2026, 10, 27, 12).getTime())).toBe(true);
    expect(next_due(thursdays, new Date(2026, 10, 26, 8).getTime())).toBe(new Date(2026, 11, 3, 8).getTime());
    expect(next_due(thursdays, new Date(2026, 10, 26, 7, 59, 30).getTime())).toBe(new Date(2026, 10, 26, 8).getTime());
  });
});
