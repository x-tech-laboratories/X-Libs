// Reads durations such as "2h30m" from settings and writes them back in words, for the server and the agent alike.

import parse from "parse-duration";

const unit_names = [["weeks", 604800], ["days", 86400], ["hours", 3600], ["minutes", 60], ["seconds", 1]] as const;

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

// The two largest whole units, such as "1 day, 2 hours".
export function format_duration(seconds: number): string {
  if (seconds < 1) return "0 seconds";
  const parts: Partial<Record<(typeof unit_names)[number][0], number>> = {};
  let remaining = Math.floor(seconds);
  for (const [name, size] of unit_names) {
    if (Object.keys(parts).length === 2) break;
    if (remaining < size) continue;
    parts[name] = Math.floor(remaining / size);
    remaining %= size;
  }
  return words.format(parts);
}

export function format_age(seconds: number): string {
  return seconds < 0 ? "never" : `${format_duration(seconds)} ago`;
}
