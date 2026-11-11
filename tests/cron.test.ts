import { describe, expect, it } from "vitest";

import { CronSchedule } from "../src/cron.ts";

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
