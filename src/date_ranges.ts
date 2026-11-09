// Spans of local time named from now, such as "earlier today", "next week" or "the rest of this month", turned into their first and last minutes with day.js.

import dayjs, { type Dayjs } from "dayjs";

import { has_time } from "./dates.ts";

const MINUTE_FORMAT = "YYYY-MM-DDTHH:mm";

// ── Ranges ───────────────────────────────────────────────────────────────────

export const RANGE_UNITS = ["minute", "hour", "day", "week", "month", "year"] as const;

export type RangeUnit = (typeof RANGE_UNITS)[number];

// So many units from now, such as 1 week for next week; a range starts where its start edge's unit starts and ends where its end edge's unit ends.
export interface RangeEdge {
  offset: number;
  unit: RangeUnit;
}

// A side left as null stays open, so a range without an end runs on forever.
export interface RelativeRange {
  start: RangeEdge | null;
  end: RangeEdge | null;
}

// The first and last minutes a range covers, as "YYYY-MM-DDTHH:MM", or null on an open side.
export interface ResolvedRange {
  first: string | null;
  last: string | null;
}

// Weeks start on the given weekday, from 0 for Sunday to 6 for Saturday.
export function resolve_range(range: RelativeRange, now = new Date(), week_start = 1): ResolvedRange {
  return {
    first: range.start && edge_moment(range.start, "start", now, week_start).format(MINUTE_FORMAT),
    last: range.end && edge_moment(range.end, "end", now, week_start).format(MINUTE_FORMAT),
  };
}

function edge_moment(edge: RangeEdge, side: "start" | "end", now: Date, week_start: number): Dayjs {
  const moved = dayjs(now).add(edge.offset, edge.unit);
  if (edge.unit !== "week") return side === "start" ? moved.startOf(edge.unit) : moved.endOf(edge.unit);

  const first_day = moved.subtract((moved.day() - week_start + 7) % 7, "day").startOf("day");
  return side === "start" ? first_day : first_day.add(6, "day").endOf("day");
}

// ── Matching ─────────────────────────────────────────────────────────────────

// A date without a time stands for its last minute, so it belongs to a range that runs to the end of its day.
export function is_in_range(local_date: string, range: ResolvedRange): boolean {
  const moment = has_time(local_date) ? local_date : `${local_date}T23:59`;
  return (range.first === null || moment >= range.first) && (range.last === null || moment <= range.last);
}
