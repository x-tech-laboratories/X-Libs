// Five-field cron expressions read in local time: minute, hour, day of month, month, day of week, with the @daily
// style aliases and month and weekday names. On them, the simpler schedules a user picks for recurring work: every so
// many minutes, hours or days after it last ran, or at a time on chosen weekdays, due once however often it was missed.

// ── Expressions ──────────────────────────────────────────────────────────────

const aliases: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

const month_names: Record<string, number> = Object.fromEntries(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((name, index) => [name, index + 1]),
);

const weekday_names: Record<string, number> = Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((name, index) => [name, index]));

// Long enough to reach a 29 February across a century year that skips its leap day.
const search_days = 366 * 9;

function field_value(text: string, names: Record<string, number>, label: string): number {
  const lowered = text.toLowerCase();
  if (Object.hasOwn(names, lowered)) return names[lowered];
  if (!/^\d+$/.test(text)) throw new Error(`${label} has an unrecognised value '${text}'`);
  return Number(text);
}

// Expands one field, such as "*/15", "1-5" or "mon,wed", into the values it allows.
function parse_field(text: string, low: number, high: number, label: string, names: Record<string, number> = {}): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const slash = part.indexOf("/");
    const base = slash === -1 ? part : part.slice(0, slash);
    const step_text = slash === -1 ? "" : part.slice(slash + 1);
    let step = 1;
    if (step_text) {
      if (!/^\d+$/.test(step_text) || Number(step_text) === 0) throw new Error(`${label} has a bad step '${step_text}'`);
      step = Number(step_text);
    }
    let start: number;
    let end: number;
    if (base === "*") {
      start = low;
      end = high;
    } else if (base.includes("-")) {
      const dash = base.indexOf("-");
      start = field_value(base.slice(0, dash), names, label);
      end = field_value(base.slice(dash + 1), names, label);
    } else {
      start = field_value(base, names, label);
      // A lone value with a step, as in "5/10", runs from that value to the end of the range.
      end = step_text ? high : start;
    }
    if (!(low <= start && start <= high && low <= end && end <= high) || start > end) throw new Error(`${label} value '${base}' is outside ${low}-${high}`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export class CronSchedule {
  readonly expression: string;
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly weekdays: ReadonlySet<number>;
  readonly any_day: boolean;
  readonly any_weekday: boolean;

  private constructor(expression: string, fields: string[]) {
    const [minute, hour, day, month, weekday] = fields;
    this.expression = expression;
    this.minutes = parse_field(minute, 0, 59, "minute");
    this.hours = parse_field(hour, 0, 23, "hour");
    this.days = parse_field(day, 1, 31, "day of month");
    this.months = parse_field(month, 1, 12, "month", month_names);
    // Cron allows 7 as a second name for Sunday.
    this.weekdays = new Set([...parse_field(weekday, 0, 7, "day of week", weekday_names)].map((value) => (value === 7 ? 0 : value)));
    this.any_day = day.startsWith("*");
    this.any_weekday = weekday.startsWith("*");
  }

  // Reads an expression such as "30 2 * * *" or "@daily", throwing when it is malformed or never matches.
  static parse(expression: string): CronSchedule {
    const text = String(expression).trim();
    const fields = (aliases[text.toLowerCase()] ?? text).split(/\s+/).filter((field) => field !== "");
    if (fields.length !== 5) throw new Error(`cron expression '${text}' needs five fields: minute hour day-of-month month day-of-week`);
    const schedule = new CronSchedule(text, fields);
    if (schedule.next_after(new Date(2000, 0, 1)) === null) throw new Error(`cron expression '${text}' never matches a real date`);
    return schedule;
  }

  // Whether it runs on this date; a restricted day of month and day of week match either, as cron does.
  matches_day(day: Date): boolean {
    if (!this.months.has(day.getMonth() + 1)) return false;
    const weekday = day.getDay();
    if (this.any_day && this.any_weekday) return true;
    if (this.any_day) return this.weekdays.has(weekday);
    if (this.any_weekday) return this.days.has(day.getDate());
    return this.days.has(day.getDate()) || this.weekdays.has(weekday);
  }

  // The first run strictly after `moment`, in local time, or null when there is none.
  next_after(moment: Date): Date | null {
    const start = new Date(moment.getFullYear(), moment.getMonth(), moment.getDate(), moment.getHours(), moment.getMinutes() + 1);
    const hours = [...this.hours].sort((a, b) => a - b);
    const minutes = [...this.minutes].sort((a, b) => a - b);
    let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    for (let step = 0; step < search_days; step++) {
      if (this.matches_day(day)) {
        for (const hour of hours) {
          for (const minute of minutes) {
            const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
            if (candidate >= start) return candidate;
          }
        }
      }
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    }
    return null;
  }
}

// ── Schedules ────────────────────────────────────────────────────────────────

export type IntervalUnit = "minutes" | "hours" | "days";

// Every so many minutes, hours or days; or at a time of day on the weekdays chosen (0 is Sunday).
export type RunSchedule = { kind: "every"; every: number; unit: IntervalUnit } | { kind: "at"; time: string; weekdays: number[] };

export interface ScheduleLimits {
  // The fewest minutes an "every" schedule may run apart; 1 unless the app sets more.
  min_minutes?: number;
}

const unit_ms: Record<IntervalUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

const weekday_words = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The schedule given, checked, or a plain reason it is not one.
export function checked_schedule(given: unknown, limits: ScheduleLimits = {}): RunSchedule {
  const value = (given ?? {}) as Record<string, unknown>;
  if (value.kind === "every") {
    const every = Number(value.every);
    const unit = String(value.unit) as IntervalUnit;
    const min_minutes = limits.min_minutes ?? 1;
    if (!Object.hasOwn(unit_ms, unit)) throw new Error('A schedule\'s unit is "minutes", "hours" or "days".');
    if (!Number.isInteger(every) || every < 1) throw new Error("A schedule runs every whole number of minutes, hours or days, one or more.");
    if (unit === "minutes" && every < min_minutes) throw new Error(`A schedule runs at most every ${min_minutes} minutes.`);
    return { kind: "every", every, unit };
  }
  if (value.kind === "at") {
    const time = String(value.time ?? "");
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!match) throw new Error("A schedule's time is a 24-hour time such as 07:30.");
    const weekdays = Array.isArray(value.weekdays) ? [...new Set(value.weekdays.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort((a, b) => a - b) : [];
    if (weekdays.length === 0) throw new Error("A schedule at a time runs on one weekday or more, 0 being Sunday.");
    return { kind: "at", time: `${match[1]!.padStart(2, "0")}:${match[2]}`, weekdays };
  }
  throw new Error('A schedule is { kind: "every", every, unit } or { kind: "at", time, weekdays }.');
}

function word_list(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// The schedule in plain words, such as "every 2 hours" or "at 07:30 on Monday and Friday".
export function describe_schedule(schedule: RunSchedule): string {
  if (schedule.kind === "every") return schedule.every === 1 ? `every ${schedule.unit.slice(0, -1)}` : `every ${schedule.every} ${schedule.unit}`;
  const days =
    schedule.weekdays.length === 7
      ? "every day"
      : schedule.weekdays.length === 5 && schedule.weekdays.every((day) => day >= 1 && day <= 5)
        ? "on weekdays"
        : `on ${word_list(schedule.weekdays.map((day) => weekday_words[day]!))}`;
  return `at ${schedule.time} ${days}`;
}

// An "at" schedule as the cron expression naming the same moments.
export function schedule_cron(schedule: Extract<RunSchedule, { kind: "at" }>): CronSchedule {
  const [hours, minutes] = schedule.time.split(":").map(Number) as [number, number];
  return CronSchedule.parse(`${minutes} ${hours} * * ${schedule.weekdays.join(",")}`);
}

// When the work falls due next, given when it last ran or was made.
export function next_due(schedule: RunSchedule, since: number): number {
  if (schedule.kind === "every") return since + schedule.every * unit_ms[schedule.unit];
  return schedule_cron(schedule).next_after(new Date(since))?.getTime() ?? since + unit_ms.days;
}

// Whether the work is due now, given when it last ran or was made: once, however many times it was missed.
export function is_due(schedule: RunSchedule, since: number, now: number): boolean {
  if (schedule.kind === "every") return now - since >= schedule.every * unit_ms[schedule.unit];
  return next_due(schedule, since) <= now;
}
