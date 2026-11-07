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
