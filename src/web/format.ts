// Writes times, durations, sizes and counts short enough for a table cell.

// ── Times ────────────────────────────────────────────────────────────────────

export function now_seconds(): number {
  return Date.now() / 1000;
}

export function age(epoch: number | null | undefined): string {
  if (!epoch) return "never";
  const seconds = Math.max(0, now_seconds() - epoch);
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 129600) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

// How long until the epoch, such as "in 3d", or how long ago when it has passed.
export function until(epoch: number | null): string {
  if (epoch === null) return "—";
  const seconds = epoch - now_seconds();
  return seconds < 0 ? age(epoch) : `in ${duration(seconds)}`;
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
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = count;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}

// Sizes in decimal units, such as "1.2 GB".
export function size(count: number | null | undefined): string {
  if (count === null || count === undefined) return "—";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let value = Math.abs(count);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${count < 0 ? "−" : ""}${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

// A size change with its sign, such as +1.2 GB or −300 MB.
export function size_change(count: number | null | undefined): string {
  if (count === null || count === undefined) return "—";
  return count > 0 ? `+${size(count)}` : size(count);
}

// ── Counts ───────────────────────────────────────────────────────────────────

export function count_change(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value > 0 ? `+${value.toLocaleString()}` : value < 0 ? `−${Math.abs(value).toLocaleString()}` : "0";
}

export function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}
