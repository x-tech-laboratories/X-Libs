// Spans of local time named from now, such as "earlier today" or "next week", each a day.js comparison (before, after or between) with points like the start of today or the end of next week.

import dayjs, { type Dayjs } from "dayjs";
import is_between from "dayjs/plugin/isBetween.js";

import { has_time } from "./dates.ts";

dayjs.extend(is_between);

// ── Points ───────────────────────────────────────────────────────────────────

export const DATE_POINT_UNITS = ["day", "week", "month", "year"] as const;

export type DatePointUnit = (typeof DATE_POINT_UNITS)[number];

export const DATE_POINT_STEPS = { last: -1, this: 0, next: 1 } as const;

export type DatePointStep = keyof typeof DATE_POINT_STEPS;

// The current minute, or the start or end of a day, week, month or year counted from this one, such as "start_of_next_day" for midnight tomorrow.
export type DatePoint =
  "now" | `${"start" | "end"}_of_${DatePointStep}_${DatePointUnit}`;

// Every point in the order a picker lists them: now, then each unit from last to next, start before end.
export const DATE_POINTS: DatePoint[] = [
  "now",
  ...DATE_POINT_UNITS.flatMap((unit) =>
    (Object.keys(DATE_POINT_STEPS) as DatePointStep[]).flatMap(
      (step) =>
        [`start_of_${step}_${unit}`, `end_of_${step}_${unit}`] as DatePoint[],
    ),
  ),
];

const DAY_NAMES: Record<DatePointStep, string> = {
  last: "yesterday",
  this: "today",
  next: "tomorrow",
};

// Reads a point as English, such as "Start of tomorrow" or "End of next week".
export function date_point_label(point: DatePoint): string {
  if (point === "now") return "Now";
  const [edge, , step, unit] = point.split("_") as [
    "start" | "end",
    "of",
    DatePointStep,
    DatePointUnit,
  ];
  const span = unit === "day" ? DAY_NAMES[step] : `${step} ${unit}`;
  return `${edge === "start" ? "Start" : "End"} of ${span}`;
}

// Weeks start on the given weekday, from 0 for Sunday to 6 for Saturday.
export function resolve_point(
  point: DatePoint,
  now = new Date(),
  week_start = 1,
): Dayjs {
  if (point === "now") return dayjs(now).startOf("minute");
  const [edge, , step, unit] = point.split("_") as [
    "start" | "end",
    "of",
    DatePointStep,
    DatePointUnit,
  ];
  const moved = dayjs(now).add(DATE_POINT_STEPS[step], unit);
  if (unit !== "week")
    return edge === "start" ? moved.startOf(unit) : moved.endOf(unit);

  const first_day = moved
    .subtract((moved.day() - week_start + 7) % 7, "day")
    .startOf("day");
  return edge === "start" ? first_day : first_day.add(6, "day").endOf("day");
}

// ── Rules ────────────────────────────────────────────────────────────────────

export const DATE_COMPARISONS = [
  "is_before",
  "is_after",
  "is_between",
] as const;

export type DateComparison = (typeof DATE_COMPARISONS)[number];

// Which ends of a between rule count as inside, in day.js's bracket notation: "[" or "]" keeps the end, "(" or ")" leaves it out.
export const INCLUSIVITIES = ["[]", "[)", "(]", "()"] as const;

export type Inclusivity = (typeof INCLUSIVITIES)[number];

// A date is before `to`, after `from`, or between the two; inclusivity applies only to between, as before and after leave their point out like day.js.
export interface DateRule {
  comparison: DateComparison;
  from: DatePoint;
  to: DatePoint;
  inclusivity: Inclusivity;
}

// The moments a rule compares against, worked out for one instant; a side the rule leaves open is null.
export interface ResolvedRule {
  from: Dayjs | null;
  to: Dayjs | null;
  inclusivity: Inclusivity;
}

export function resolve_rule(
  rule: DateRule,
  now = new Date(),
  week_start = 1,
): ResolvedRule {
  return {
    from:
      rule.comparison === "is_before"
        ? null
        : resolve_point(rule.from, now, week_start),
    to:
      rule.comparison === "is_after"
        ? null
        : resolve_point(rule.to, now, week_start),
    inclusivity: rule.comparison === "is_between" ? rule.inclusivity : "()",
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

// A date without a time stands for its last minute, so it belongs to a rule that runs to the end of its day.
export function matches_rule(local_date: string, rule: ResolvedRule): boolean {
  const moment = dayjs(
    has_time(local_date) ? local_date : `${local_date}T23:59`,
  );
  if (rule.from && rule.to)
    return moment.isBetween(rule.from, rule.to, null, rule.inclusivity);
  if (rule.from) return moment.isAfter(rule.from);
  if (rule.to) return moment.isBefore(rule.to);
  return true;
}
