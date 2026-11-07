import { describe, expect, it } from "vitest";
import { format_age, format_duration, parse_duration } from "../src/durations.ts";

describe("durations", () => {
  it("reads units, plain seconds and numbers", () => {
    expect(parse_duration("2h30m", "interval")).toBe(9000);
    expect(parse_duration("1w1d", "interval")).toBe(691200);
    expect(parse_duration(" 60S ", "interval")).toBe(60);
    expect(parse_duration("90", "interval")).toBe(90);
    expect(parse_duration(12.7, "interval")).toBe(12);
    expect(parse_duration("1.5h", "interval")).toBe(5400);
    expect(parse_duration("2 days", "interval")).toBe(172800);
  });

  it("names the setting when the value is not a duration", () => {
    expect(() => parse_duration("soon", "eval_interval")).toThrow('`eval_interval` must be a duration such as "1w", "7d", "2h30m" or "60s", not "soon"');
    expect(() => parse_duration(-1, "interval")).toThrow(/must be a duration/);
  });

  it("writes the two largest units in words", () => {
    expect(format_duration(0)).toBe("0 seconds");
    expect(format_duration(1)).toBe("1 second");
    expect(format_duration(93784)).toBe("1 day, 2 hours");
    expect(format_age(-1)).toBe("never");
    expect(format_age(120)).toBe("2 minutes ago");
  });

  it("counts weeks and 30-day months", () => {
    expect(format_duration(9 * 86400)).toBe("1 week, 2 days");
    expect(format_duration(35 * 86400)).toBe("1 month, 5 days");
    expect(format_duration(65 * 86400 + 3600)).toBe("2 months, 5 days");
  });

  it("writes units with the separator given and stops at the largest unit asked for", () => {
    expect(format_duration(9 * 86400 + 3 * 3600, { separator: " " })).toBe("1 week 2 days");
    expect(format_duration(35 * 86400, { separator: " ", largest_unit: "weeks" })).toBe("5 weeks");
    expect(format_duration(90 * 60, { separator: " ", largest_unit: "weeks" })).toBe("1 hour 30 minutes");
  });
});
