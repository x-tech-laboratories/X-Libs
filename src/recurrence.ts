// iCalendar recurrence (RFC 5545) on rrule.js: rules without their "RRULE:" prefix, such as "FREQ=WEEKLY;BYDAY=MO,WE",
// or RRULE, EXDATE and RDATE lines together. Parts and lines rrule.js cannot handle, such as RSCALE (RFC 7529) or TZID
// dates, are kept exactly as written.

import * as rrule_module from "rrule";
import type { Frequency, Options, Weekday, WeekdayStr } from "rrule";

// Node loads rrule as CommonJS, which offers its classes only on the default export; bundlers load its ES module build,
// which names them.
const { RRule, RRuleSet } = rrule_module.RRule ? rrule_module : (rrule_module as unknown as { default: typeof rrule_module }).default;

export type { Frequency, Weekday, WeekdayStr };

// "utc": dates are real moments, written in UTC with a "Z". "floating": local clock times written without a "Z", for an
// event whose start has no time zone. all_day: plain dates, for an event whose start has no time.
export type TimeMode = "utc" | "floating";
export type RuleFormat = TimeMode | { time_mode?: TimeMode; all_day?: boolean };

// How a date is written: a DATE, a DATE-TIME without "Z", or a UTC DATE-TIME.
export type IcalKind = "date" | "floating" | "utc";

// A date as rrule works with it, remembering the kind it was read as.
export type RuleDate = Date & { ical_kind?: IcalKind };

export type NumberPart = "bymonth" | "byweekno" | "byyearday" | "bymonthday" | "byhour" | "byminute" | "bysecond" | "bysetpos";
export type RulePart = NumberPart | "byweekday";

// One rule as rrule options, every BY part a list, with the parts rrule.js does not know kept in extra_parts.
export interface RuleOptions {
  freq: Frequency;
  interval?: number;
  count?: number | null;
  until?: Date | null;
  wkst?: Weekday | number | null;
  bymonth?: number[];
  byweekno?: number[];
  byyearday?: number[];
  bymonthday?: number[];
  byweekday?: Weekday[];
  byhour?: number[];
  byminute?: number[];
  bysecond?: number[];
  bysetpos?: number[];
  extra_parts?: string[];
}

// A rule with the dates it skips and adds, and the lines kept as written, such as TZID dates.
export interface Recurrence {
  rule: RuleOptions | null;
  exdates: RuleDate[];
  rdates: RuleDate[];
  extra_lines: string[];
}

// ── Names ────────────────────────────────────────────────────────────────────

export const frequency_names = ["YEARLY", "MONTHLY", "WEEKLY", "DAILY", "HOURLY", "MINUTELY", "SECONDLY"] as const;
export type FrequencyName = (typeof frequency_names)[number];

export const rule_weekday_codes: WeekdayStr[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

// What each BY part takes, by its name in a rule.
export const rule_parts: Record<RulePart, { label: string; minimum: number; maximum: number; signed: boolean }> = {
  bymonth: { label: "BYMONTH", minimum: 1, maximum: 12, signed: false },
  byweekno: { label: "BYWEEKNO", minimum: 1, maximum: 53, signed: true },
  byyearday: { label: "BYYEARDAY", minimum: 1, maximum: 366, signed: true },
  bymonthday: { label: "BYMONTHDAY", minimum: 1, maximum: 31, signed: true },
  byweekday: { label: "BYDAY", minimum: 1, maximum: 53, signed: true },
  byhour: { label: "BYHOUR", minimum: 0, maximum: 23, signed: false },
  byminute: { label: "BYMINUTE", minimum: 0, maximum: 59, signed: false },
  bysecond: { label: "BYSECOND", minimum: 0, maximum: 60, signed: false },
  bysetpos: { label: "BYSETPOS", minimum: 1, maximum: 366, signed: true },
};

const rule_part_names = ["FREQ", "UNTIL", "COUNT", "INTERVAL", "BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS", "WKST"];

// Positions in a month or set with English names; "" is every one.
export const ordinal_names: [string, string][] = [
  ["", "every"],
  ["1", "first"],
  ["2", "second"],
  ["3", "third"],
  ["4", "fourth"],
  ["5", "fifth"],
  ["-1", "last"],
  ["-2", "second last"],
  ["-3", "third last"],
  ["-4", "fourth last"],
  ["-5", "fifth last"],
];

export function frequency_name(frequency: Frequency): FrequencyName {
  return frequency_names[frequency] ?? "DAILY";
}

export function frequency_of(name: FrequencyName): Frequency {
  return frequency_names.indexOf(name) as Frequency;
}

export function weekday_of(code: WeekdayStr, position = 0): Weekday {
  const weekday = RRule[code];
  return position ? weekday.nth(position) : weekday;
}

// The English word for a position, such as "first", "last" or "12th".
export function ordinal_word(position: number): string {
  const known = ordinal_names.find(([value]) => value === String(position));
  if (known) return known[1];
  const size = Math.abs(position);
  const suffix = size % 100 >= 11 && size % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][size % 10] ?? "th");
  return position < 0 ? `${size}${suffix} last` : `${size}${suffix}`;
}

// ── Formats and dates ────────────────────────────────────────────────────────

function read_format(format: RuleFormat): { time_mode: TimeMode; all_day: boolean } {
  if (typeof format === "string") return { time_mode: format, all_day: false };
  return { time_mode: format.time_mode ?? "utc", all_day: format.all_day ?? false };
}

// A real date as rrule works with it: a UTC midnight for all-day, the local clock as UTC fields for floating, else unchanged.
export function to_rule_date(date: Date, format: RuleFormat = "utc"): Date {
  const { time_mode, all_day } = read_format(format);
  if (all_day) return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  if (time_mode !== "floating") return new Date(date);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()));
}

// A date from rrule back as a real date, the reverse of to_rule_date.
export function from_rule_date(date: Date, format: RuleFormat = "utc"): Date {
  const { time_mode, all_day } = read_format(format);
  if (all_day) return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (time_mode !== "floating") return new Date(date);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
}

// The kind a rule date is written as: the kind it was read with, else the format's.
function ical_kind(date: RuleDate, format: RuleFormat): IcalKind {
  const { time_mode, all_day } = read_format(format);
  return date.ical_kind ?? (all_day ? "date" : time_mode === "floating" ? "floating" : "utc");
}

function format_ical_date(date: Date, kind: IcalKind): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replaceAll("-", "");
  if (kind === "date") return day;
  return `${day}T${iso.slice(11, 19).replaceAll(":", "")}${kind === "floating" ? "" : "Z"}`;
}

// iCalendar DATE or DATE-TIME text as a rule date that remembers its kind; throws on anything else.
export function parse_ical_date(text: string): RuleDate {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(text.trim());
  if (!match) throw new Error(`"${text}" is not an iCalendar date.`);
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = match.slice(1, 7).map((field) => Number(field ?? 0));
  const date: RuleDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  date.ical_kind = match[4] === undefined ? "date" : match[7] ? "utc" : "floating";
  return date;
}

// ── Rules ────────────────────────────────────────────────────────────────────

// One rule as rrule options with every BY part as a list, keeping parts rrule.js does not know, such as RSCALE, in
// extra_parts; throws when it is not a rule.
export function parse_rule(rule_text: string): RuleOptions {
  const lines = String(rule_text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rule_line = lines.find((line) => /^RRULE:/i.test(line)) ?? lines[0] ?? "";
  const known_parts: string[] = [];
  const extra_parts: string[] = [];
  for (const part of rule_line.replace(/^RRULE:/i, "").split(";").map((text) => text.trim()).filter(Boolean)) {
    const name = (part.split("=")[0] ?? "").toUpperCase();
    (rule_part_names.includes(name) ? known_parts : extra_parts).push(part);
  }
  const parsed: Partial<Options> = RRule.parseString(known_parts.join(";"));
  if (parsed.freq === undefined) throw new Error("The rule has no FREQ part.");
  const options: Record<string, unknown> = { ...parsed };
  delete options.dtstart;
  delete options.tzid;
  for (const part of Object.keys(rule_parts) as RulePart[]) {
    const value = parsed[part];
    if (value === undefined || value === null) delete options[part];
    else options[part] = [value].flat().map((item) => (part === "byweekday" && typeof item === "number" ? weekday_of(rule_weekday_codes[item]!) : item));
  }
  if (extra_parts.length > 0) options.extra_parts = extra_parts;
  return options as unknown as RuleOptions;
}

function rrule_options(options: RuleOptions): Partial<Options> {
  const { extra_parts: _, ...known_options } = options;
  return known_options;
}

// A rule's value with FREQ and INTERVAL first, an UNTIL that matches the format, and any kept extra parts last.
export function format_rule(options: RuleOptions, format: RuleFormat = "utc"): string {
  const { time_mode, all_day } = read_format(format);
  const { freq, interval, extra_parts = [], ...other_options } = options;
  for (const part of Object.keys(rule_parts) as RulePart[]) if (other_options[part]?.length === 0) delete other_options[part];
  const ordered_options = interval && interval !== 1 ? { freq, interval, ...other_options } : { freq, ...other_options };
  const rule_line = RRule.optionsToString(ordered_options).split("\n").find((line) => line.startsWith("RRULE:"));
  const rule_text = (rule_line ?? "").slice("RRULE:".length).replace(/UNTIL=(\d{8})T(\d{6})Z/, (whole, day: string, time: string) => {
    if (all_day) return `UNTIL=${day}`;
    return time_mode === "floating" ? `UNTIL=${day}T${time}` : whole;
  });
  const calendar_parts = extra_parts.filter((part) => /^RSCALE=/i.test(part));
  const other_parts = extra_parts.filter((part) => !/^RSCALE=/i.test(part));
  return [...calendar_parts, rule_text, ...other_parts].filter(Boolean).join(";");
}

// A rule's non-Gregorian RSCALE part, such as "RSCALE=HEBREW", or "" when it uses the Gregorian calendar.
export function rule_calendar(options: RuleOptions | null | undefined): string {
  const calendar = (options?.extra_parts ?? []).find((part) => /^RSCALE=/i.test(part));
  return calendar && !/=GREGORIAN$/i.test(calendar) ? calendar : "";
}

// A comma or space separated list for one BY part; throws a message naming the values it allows.
export function parse_rule_part(part: "byweekday", text: string): Weekday[];
export function parse_rule_part(part: NumberPart, text: string): number[];
export function parse_rule_part(part: RulePart, text: string): number[] | Weekday[];
export function parse_rule_part(part: RulePart, text: string): number[] | Weekday[] {
  const tokens = String(text).split(/[\s,]+/).filter(Boolean);
  if (part === "byweekday") {
    return tokens.map((token) => {
      const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(token);
      const position = match?.[1] ? Number(match[1]) : 0;
      if (!match || Math.abs(position) > 53) throw new Error(`BYDAY takes weekdays such as MO or -1FR, not "${token}".`);
      return weekday_of(match[2]!.toUpperCase() as WeekdayStr, position);
    });
  }
  const { label, minimum, maximum, signed } = rule_parts[part];
  return tokens.map((token) => {
    const number = Number(token);
    const size = Math.abs(number);
    if (!Number.isInteger(number) || size < minimum || size > maximum || (number < 0 && !signed)) {
      throw new Error(`${label} takes whole numbers from ${signed ? `-${maximum} to -${minimum} and ` : ""}${minimum} to ${maximum}, not "${token}".`);
    }
    return number;
  });
}

// ── Recurrence sets ──────────────────────────────────────────────────────────

// Whether text holds iCalendar property lines rather than a bare rule.
export function is_recurrence_text(text: string): boolean {
  return /\n/.test(text) || /^(RRULE|EXDATE|RDATE|DTSTART)[:;]/i.test(text.trim());
}

// RRULE, EXDATE and RDATE lines; lines it cannot edit, such as TZID dates, are kept as written in extra_lines.
export function parse_recurrence(text: string): Recurrence {
  const recurrence: Recurrence = { rule: null, exdates: [], rdates: [], extra_lines: [] };
  const lines: string[] = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && lines.length > 0) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  for (const line of lines.map((text) => text.trim()).filter(Boolean)) {
    const colon = line.indexOf(":");
    const [name, ...parameters] = (colon < 0 ? "" : line.slice(0, colon)).toUpperCase().split(";");
    const value = line.slice(colon + 1);
    const plain_dates = parameters.every((parameter) => parameter === "VALUE=DATE" || parameter === "VALUE=DATE-TIME");
    if (name === "RRULE" && !recurrence.rule) recurrence.rule = parse_rule(value);
    else if ((name === "EXDATE" || name === "RDATE") && plain_dates) {
      recurrence[name === "EXDATE" ? "exdates" : "rdates"].push(...value.split(",").map(parse_ical_date));
    } else if (colon < 0 && !recurrence.rule && /FREQ=/i.test(line)) recurrence.rule = parse_rule(line);
    else recurrence.extra_lines.push(line);
  }
  if (!recurrence.rule && recurrence.rdates.length === 0) throw new Error("There is no RRULE or RDATE.");
  return recurrence;
}

// A recurrence written back as RRULE, EXDATE and RDATE lines in the format, followed by any kept lines.
export function format_recurrence(recurrence: Recurrence, format: RuleFormat = "utc"): string {
  const date_lines = (name: string, dates: RuleDate[]) =>
    (["date", "floating", "utc"] as const)
      .map((kind) => [kind, dates.filter((date) => ical_kind(date, format) === kind)] as const)
      .filter(([, kind_dates]) => kind_dates.length > 0)
      .map(([kind, kind_dates]) => `${name}${kind === "date" ? ";VALUE=DATE" : ""}:${kind_dates.map((date) => format_ical_date(date, kind)).join(",")}`);
  const lines: string[] = [];
  if (recurrence.rule) lines.push(`RRULE:${format_rule(recurrence.rule, format)}`);
  lines.push(...date_lines("EXDATE", recurrence.exdates), ...date_lines("RDATE", recurrence.rdates));
  return [...lines, ...recurrence.extra_lines].join("\n");
}

// A value of either kind as a recurrence.
export function read_recurrence(text: string): Recurrence {
  return is_recurrence_text(text) ? parse_recurrence(text) : { rule: parse_rule(text), exdates: [], rdates: [], extra_lines: [] };
}

// Throws for RSCALE calendars, which rrule.js cannot calculate.
function build_rule_set(recurrence: Recurrence, rule_start: Date): InstanceType<typeof RRuleSet> {
  const calendar = rule_calendar(recurrence.rule);
  if (calendar) throw new Error(`rrule.js cannot calculate ${calendar}.`);
  const rule_set = new RRuleSet();
  if (recurrence.rule) rule_set.rrule(new RRule({ ...rrule_options(recurrence.rule), dtstart: rule_start }));
  for (const date of recurrence.rdates) rule_set.rdate(date);
  for (const date of recurrence.exdates) rule_set.exdate(date);
  return rule_set;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// A rule or recurrence in plain English with dates in local time, or "" when it has no English form.
export function describe_rule(text: string, format: RuleFormat = "utc"): string {
  if (!text) return "";
  const { all_day, time_mode } = read_format(format);
  try {
    const recurrence = read_recurrence(text);
    if (!recurrence.rule || rule_calendar(recurrence.rule)) return "";
    const { byhour, byminute, bysecond, bysetpos, count, until, ...pattern } = rrule_options(recurrence.rule);
    const rule = new RRule(pattern);
    if (!rule.isFullyConvertibleToText()) return "";
    const plural = (number: number, word: string) => `${number} ${word}${number === 1 ? "" : "s"}`;
    const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
    const pad = (number: number) => String(number).padStart(2, "0");
    const hours = byhour as number[] | undefined;
    const minutes = byminute as number[] | undefined;
    const seconds = bysecond as number[] | undefined;
    let description = rule.toText();
    if (bysetpos) description += `, only the ${list((bysetpos as number[]).map(ordinal_word))} of those`;
    if (hours) {
      const times = hours.flatMap((hour) => (minutes ?? [0]).flatMap((minute) => (seconds ?? [null]).map((second) => `${pad(hour)}:${pad(minute)}${second === null ? "" : `:${pad(second)}`}`)));
      description += ` at ${list(times)}`;
    } else {
      if (minutes) description += ` at ${list(minutes.map(String))} minutes past the hour`;
      if (seconds) description += `${minutes ? " and" : " at"} ${list(seconds.map(String))} seconds past the minute`;
    }
    if (count) description += ` for ${plural(count, "time")}`;
    if (until) {
      const local_until = all_day || time_mode === "floating" ? until : to_rule_date(until, "floating");
      description += ` until ${local_until.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
    }
    if (recurrence.exdates.length > 0) description += `, except ${plural(recurrence.exdates.length, "date")}`;
    if (recurrence.rdates.length > 0) description += `, plus ${plural(recurrence.rdates.length, "other date")}`;
    return description.charAt(0).toUpperCase() + description.slice(1);
  } catch {
    return "";
  }
}

// The occurrence after start_date and the value to carry forward, with COUNT lowered by one; null once it has ended.
export function next_occurrence(text: string, start_date: Date, format: RuleFormat = "utc"): { next_date: Date; rule: string } | null {
  const recurrence = read_recurrence(text);
  const rule_start = to_rule_date(start_date, format);
  const next_date = build_rule_set(recurrence, rule_start).after(rule_start, false);
  if (!next_date) return null;
  if (recurrence.rule?.count) recurrence.rule.count -= 1;
  const next_text = is_recurrence_text(text) ? format_recurrence(recurrence, format) : format_rule(recurrence.rule!, format);
  return { next_date: from_rule_date(next_date, format), rule: next_text };
}

// The first occurrence from the current minute onwards for a rule counted from then, or null when it yields none.
export function next_from_now(text: string, format: RuleFormat = "utc", now = new Date()): Date | null {
  const this_minute = new Date(now);
  this_minute.setSeconds(0, 0);
  const rule_start = to_rule_date(this_minute, format);
  const next_date = build_rule_set(read_recurrence(text), rule_start).after(rule_start, true);
  return next_date ? from_rule_date(next_date, format) : null;
}
