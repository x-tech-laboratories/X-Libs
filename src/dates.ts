// Local calendar dates written as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM", read and written in the device's own time zone.

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

// ── Text and dates ───────────────────────────────────────────────────────────

export function has_time(local_date: string): boolean {
  return local_date.includes("T");
}

// A date without a time stands for midnight at the start of its day.
export function parse_local(local_date: string): Date {
  const [day = "", time = "00:00"] = local_date.split("T");
  const [year = 0, month = 1, day_of_month = 1] = day.split("-").map(Number);
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return new Date(year, month - 1, day_of_month, hours, minutes);
}

export function format_local(date: Date, with_time: boolean): string {
  const pad = (number: number) => String(number).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return with_time ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

// ── Arithmetic ───────────────────────────────────────────────────────────────

export function start_of_day(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Whole calendar days from the first date to the second, so a clock change in between still counts as one day.
export function days_between(first: Date, second: Date): number {
  return Math.round((start_of_day(second).getTime() - start_of_day(first).getTime()) / DAY_IN_MILLISECONDS);
}

export function add_days(date: Date, days: number): Date {
  const moved = new Date(date);
  moved.setDate(moved.getDate() + days);
  return moved;
}

// A day past the end of the target month falls back to its last day, so Jan 31 plus a month is Feb 28.
export function add_months(date: Date, months: number): Date {
  const last_day = new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate();
  return new Date(
    date.getFullYear(), date.getMonth() + months, Math.min(date.getDate(), last_day),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(),
  );
}

// ── Days and months ──────────────────────────────────────────────────────────

// Today on this device, such as "2026-06-10".
export function today(now = new Date()): string {
  return format_local(now, false);
}

export function shift_day(local_date: string, days: number): string {
  return format_local(add_days(parse_local(local_date), days), false);
}

// A real day such as "2026-02-28", never "2026-02-30" or a day with a time.
export function is_day(text: unknown): text is string {
  return typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text) && format_local(parse_local(text), false) === text;
}

// The month of a date, such as "2026-06", taken from the text so a time zone never moves the 1st into the month before.
export function month_of(local_date: string): string {
  return local_date.slice(0, 7);
}

export function this_month(now = new Date()): string {
  return month_of(today(now));
}

export function is_month(text: unknown): text is string {
  return typeof text === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

export function shift_month(month: string, months: number): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const index = year * 12 + number - 1 + months;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// The months from first to last, both included, oldest first.
export function months_from(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = shift_month(month, 1)) months.push(month);
  return months;
}

// A month in the reader's language, such as "June 2026", or "Jun 2026" when short.
export function format_month(month: string, locale?: string, short = false): string {
  return parse_local(`${month}-01`).toLocaleDateString(locale || undefined, { month: short ? "short" : "long", year: "numeric" });
}

// ── Labels ───────────────────────────────────────────────────────────────────

// A date without a time is overdue only once its day has passed.
export function is_overdue(local_date: string, now = new Date()): boolean {
  const date = parse_local(local_date);
  return has_time(local_date) ? date < now : date < start_of_day(now);
}

// Yesterday, Today or Tomorrow in the reader's language, else a short date with the year only when it is not this year, then the time if there is one.
export function relative_day_label(local_date: string, now = new Date(), locale?: string): string {
  const date = parse_local(local_date);
  const day_offset = days_between(now, date);
  const day_label = Math.abs(day_offset) <= 1
    ? capitalised(new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(day_offset, "day"), locale)
    : date.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    });

  if (!has_time(local_date)) return day_label;
  return `${day_label} ${date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}`;
}

function capitalised(text: string, locale?: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
