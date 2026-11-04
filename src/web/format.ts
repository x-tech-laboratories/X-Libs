// Writes times, durations, sizes and counts short enough for a table cell.

import pretty_bytes from "pretty-bytes";

// ── Times ────────────────────────────────────────────────────────────────────

export function now_seconds(): number {
  return Date.now() / 1000;
}

const relative = new Intl.RelativeTimeFormat("en", { style: "narrow", numeric: "always" });

const plurals = new Intl.PluralRules("en");

// A whole number of the largest unit that reads well, such as -3 hours, for "3h ago" or "in 3h".
function relative_time(seconds: number): string {
  const magnitude = Math.abs(seconds);
  const sign = seconds < 0 ? -1 : 1;
  if (magnitude < 90) return relative.format(sign * Math.round(magnitude), "second");
  if (magnitude < 5400) return relative.format(sign * Math.round(magnitude / 60), "minute");
  if (magnitude < 129600) return relative.format(sign * Math.round(magnitude / 3600), "hour");
  return relative.format(sign * Math.round(magnitude / 86400), "day");
}

export function age(epoch: number | null | undefined): string {
  if (!epoch) return "never";
  return relative_time(-Math.max(0, now_seconds() - epoch));
}

// How long until the epoch, such as "in 3d", "now" when it is less than 90 seconds off, or how long ago once passed.
export function until(epoch: number | null): string {
  if (epoch === null) return "—";
  const seconds = epoch - now_seconds();
  if (seconds < 0) return age(epoch);
  return seconds < 90 ? "now" : relative_time(seconds);
}

export function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  // Settings are often whole days or hours, which read better without a decimal.
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds < 120) return `${Math.round(seconds)}s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return seconds % 3600 === 0 ? `${seconds / 3600}h` : `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function stamp(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString();
}

// ── Sizes ────────────────────────────────────────────────────────────────────

// Sizes in binary units, such as "44.4 GiB".
export function bytes(count: number): string {
  return pretty_bytes(count, { binary: true, maximumFractionDigits: 1 });
}

// Sizes in decimal units, such as "1.2 GB".
export function size(count: number | null | undefined): string {
  if (count === null || count === undefined) return "—";
  return pretty_bytes(count, { maximumFractionDigits: 1 });
}

// A size change with its sign, such as +1.2 GB or -300 MB.
export function size_change(count: number | null | undefined): string {
  if (count === null || count === undefined) return "—";
  return count === 0 ? size(0) : pretty_bytes(count, { signed: true, maximumFractionDigits: 1 });
}

// ── Counts ───────────────────────────────────────────────────────────────────

export function count_change(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value > 0 ? `+${value.toLocaleString()}` : value < 0 ? `−${Math.abs(value).toLocaleString()}` : "0";
}

export function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${plurals.select(count) === "one" ? "" : "s"}`;
}
