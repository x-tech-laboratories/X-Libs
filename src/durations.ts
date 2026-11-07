// Reads durations such as "2h30m" from settings and writes them back in words, for the server and the agent alike.

import parse from "parse-duration";

// A month counts as 30 days.
const unit_names = [["months", 2592000], ["weeks", 604800], ["days", 86400], ["hours", 3600], ["minutes", 60], ["seconds", 1]] as const;

export type DurationUnit = (typeof unit_names)[number][0];

export interface DurationWording {
  // What goes between the units, such as " " for "1 week 2 days"; a comma when not given.
  separator?: string;
  // The largest unit used, such as "weeks" so 35 days read "5 weeks".
  largest_unit?: DurationUnit;
}

const words = new Intl.DurationFormat("en", { style: "long" });

// A duration in whole seconds; `key` names the setting in the error.
export function parse_duration(value: unknown, key: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  const text = String(value).trim();
  // A bare number is seconds, where parse-duration would read milliseconds.
  const seconds = /^\d+$/.test(text) ? Number(text) : parse(text, "s");
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`\`${key}\` must be a duration such as "1w", "7d", "2h30m" or "60s", not ${JSON.stringify(value)}`);
  }
  return Math.floor(seconds);
}

// The two largest whole units, such as "1 day, 2 hours" or, with a space between, "1 week 2 days".
export function format_duration(seconds: number, wording: DurationWording = {}): string {
  if (seconds < 1) return "0 seconds";
  const first_unit = unit_names.findIndex(([name]) => name === (wording.largest_unit ?? "months"));
  const parts: Partial<Record<DurationUnit, number>> = {};
  let remaining = Math.floor(seconds);
  for (const [name, size] of unit_names.slice(first_unit)) {
    if (Object.keys(parts).length === 2) break;
    if (remaining < size) continue;
    parts[name] = Math.floor(remaining / size);
    remaining %= size;
  }
  if (wording.separator === undefined) return words.format(parts);
  return Object.entries(parts).map(([name, count]) => words.format({ [name]: count })).join(wording.separator);
}

export function format_age(seconds: number): string {
  return seconds < 0 ? "never" : `${format_duration(seconds)} ago`;
}

// A playing time as a clock, such as "3:07", or "1:02:03" from an hour.
export function format_clock(milliseconds: number | null | undefined, empty = "0:00"): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) return empty;
  const total = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
