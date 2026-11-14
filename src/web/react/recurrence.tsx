// A form field for iCalendar recurrence (RFC 5545) on the recurrence module, drawn as Halon fields: every N units,
// weekdays, months, days of the month, weekday entries such as "the last Friday", times, an end, dates to skip and add,
// and every BY part directly under More options. Parts and lines it cannot edit are kept exactly as written.

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import {
  describe_rule, format_recurrence, format_rule, frequency_name, frequency_of, ordinal_names, read_recurrence, rule_calendar, parse_rule_part, rule_parts, rule_weekday_codes, to_rule_date,
  weekday_of, type FrequencyName, type RuleDate, type RuleFormat, type RuleOptions, type RulePart, type Weekday, type WeekdayStr,
} from "../../recurrence.ts";
import { NumberField } from "./controls.tsx";
import { FormGroup } from "./layout.tsx";

// ── Features ─────────────────────────────────────────────────────────────────

export type RecurrenceFeature = "times" | "month-days" | "weekday-entries" | "months" | "set-position" | "filters" | "sub-daily" | "exdates" | "more-options";

const standard_features: RecurrenceFeature[] = ["times", "month-days", "weekday-entries", "months", "set-position", "filters", "sub-daily", "exdates"];
const feature_presets: Record<string, RecurrenceFeature[]> = { simple: [], standard: standard_features, full: [...standard_features, "more-options"] };

// Presets and feature names add, names starting with "-" remove, such as "standard -sub-daily"; nothing means standard.
export function read_features(text = ""): Set<RecurrenceFeature> {
  const features = new Set<RecurrenceFeature>();
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  for (const token of tokens.length > 0 ? tokens : ["standard"]) {
    const name = token.replace(/^[-+]/, "").toLowerCase();
    for (const feature of feature_presets[name] ?? [name as RecurrenceFeature]) {
      if (token.startsWith("-")) features.delete(feature);
      else features.add(feature);
    }
  }
  return features;
}

// ── Names ────────────────────────────────────────────────────────────────────

const display_weekday_codes: WeekdayStr[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const weekday_labels: Record<"long" | "short" | "narrow", Record<WeekdayStr, string>> = {
  long: { SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday" },
  short: { SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat" },
  narrow: { SU: "S", MO: "M", TU: "T", WE: "W", TH: "T", FR: "F", SA: "S" },
};

const frequency_units: [FrequencyName, string][] = [
  ["SECONDLY", "second(s)"],
  ["MINUTELY", "minute(s)"],
  ["HOURLY", "hour(s)"],
  ["DAILY", "day(s)"],
  ["WEEKLY", "week(s)"],
  ["MONTHLY", "month(s)"],
  ["YEARLY", "year(s)"],
];

const month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const time_of_day_frequencies: FrequencyName[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const day_of_month_frequencies: FrequencyName[] = ["MONTHLY", "YEARLY"];
const sub_daily_frequencies: FrequencyName[] = ["HOURLY", "MINUTELY", "SECONDLY"];

type DayMode = "start" | "days" | "weekdays" | "both";
type EndType = "never" | "count" | "until";

// ── State ────────────────────────────────────────────────────────────────────

type Draft = Omit<RuleOptions, "freq"> & { freq?: RuleOptions["freq"] };

interface FieldState {
  enabled: boolean;
  options: Draft;
  exdates: RuleDate[];
  rdates: RuleDate[];
  extra_lines: string[];
  // Why the value could not be read; the value then stays as given until the field is edited.
  load_error: string;
  unreadable: string;
  // The whole value of a rule in a calendar rrule.js cannot calculate, kept as written.
  verbatim: string;
  // A problem per field, such as a list a BY part does not allow, which keeps that field's text as typed.
  errors: Record<string, string>;
  // The time rows as typed, kept while they are being edited so they never jump into order.
  times: string[] | null;
  // The value and formats the state was read from or last gave, so a new one from the page reloads it.
  key: string;
}

function empty_state(key: string): FieldState {
  return { enabled: false, options: {}, exdates: [], rdates: [], extra_lines: [], load_error: "", unreadable: "", verbatim: "", errors: {}, times: null, key };
}

function load_state(text: string, ical: boolean, key: string): FieldState {
  const state = empty_state(key);
  const trimmed = text.trim();
  if (trimmed === "") return state;
  try {
    const recurrence = read_recurrence(trimmed);
    if (!recurrence.rule) throw new Error("The form needs an RRULE line.");
    Object.assign(state, { enabled: true, options: recurrence.rule }, ical ? { exdates: recurrence.exdates, rdates: recurrence.rdates, extra_lines: recurrence.extra_lines } : {});
    if (rule_calendar(recurrence.rule)) state.verbatim = trimmed;
  } catch (error) {
    state.enabled = true;
    state.unreadable = trimmed;
    state.load_error = `This is not a recurrence rule the form can read: ${(error as Error).message}`;
  }
  return state;
}

function value_of(state: FieldState, ical: boolean, format: RuleFormat): string {
  if (state.load_error) return state.unreadable;
  if (state.verbatim) return state.enabled ? state.verbatim : "";
  if (!state.enabled || state.options.freq === undefined) return "";
  const rule = state.options as RuleOptions;
  return ical ? format_recurrence({ rule, exdates: state.exdates, rdates: state.rdates, extra_lines: state.extra_lines }, format) : format_rule(rule, format);
}

// A copy to edit; a time list being fixed stays as typed, any other edit shows the rule's times again.
function copy_state(state: FieldState): FieldState {
  const keep_times = Boolean(state.errors.times);
  return { ...state, options: { ...state.options }, exdates: [...state.exdates], rdates: [...state.rdates], errors: { ...state.errors }, times: keep_times ? state.times : null };
}

function set_list<Part extends RulePart>(options: Draft, part: Part, values: NonNullable<Draft[Part]>): void {
  if (values.length > 0) options[part] = values;
  else delete options[part];
}

function frequency_shown(options: Draft): FrequencyName {
  return options.freq === undefined ? "DAILY" : frequency_name(options.freq);
}

// A yearly rule with a day pattern but nothing naming its month, which RFC 5545 reads as every month.
function needs_month(options: Draft, ignoring_months = false): boolean {
  const has_day_pattern = Boolean(options.bymonthday?.length || options.byweekday?.length);
  const has_months = !ignoring_months && Boolean(options.bymonth?.length);
  const has_period = has_months || Boolean(options.byweekno?.length || options.byyearday?.length);
  return frequency_shown(options) === "YEARLY" && has_day_pattern && !has_period;
}

function weekday_code(weekday: Weekday | number): WeekdayStr {
  return rule_weekday_codes[typeof weekday === "number" ? weekday : weekday.weekday]!;
}

// ── Defaults and dates ───────────────────────────────────────────────────────

interface Defaults {
  month: number;
  month_day: number;
  weekday: WeekdayStr;
  ordinal: number;
}

// Day patterns default to the start's month, day and weekday, or this month, the 1st and the first Monday.
function defaults_from(start: string | null | undefined): Defaults {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(start ?? "");
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  if (!date) return { month: new Date().getMonth() + 1, month_day: 1, weekday: "MO", ordinal: 1 };
  return { month: date.getMonth() + 1, month_day: date.getDate(), weekday: display_weekday_codes[date.getDay()]!, ordinal: Math.ceil(date.getDate() / 7) };
}

// "YYYY-MM-DDTHH:MM" as a datetime-local input shows it, read from the date's local or UTC fields.
function to_datetime_input(date: Date, use_utc_fields: boolean): string {
  const pad = (number: number) => String(number).padStart(2, "0");
  const fields = use_utc_fields
    ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
    : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
  return `${fields[0]}-${pad(fields[1]!)}-${pad(fields[2]!)}T${pad(fields[3]!)}:${pad(fields[4]!)}`;
}

function rule_date_from_input(text: string, format: { time_mode: "utc" | "floating"; all_day: boolean }): RuleDate {
  if (format.all_day) return new Date(`${text.slice(0, 10)}T00:00:00Z`);
  return to_rule_date(new Date(text), format);
}

function input_from_rule_date(date: Date, format: { time_mode: "utc" | "floating"; all_day: boolean }): string {
  if (format.all_day) return date.toISOString().slice(0, 10);
  return to_datetime_input(date, format.time_mode === "floating");
}

// The end of today for a new end date, and tomorrow at nine for a new date to skip or add.
function default_input(kind: "end" | "date", all_day: boolean): string {
  const date = new Date();
  if (kind === "end") date.setHours(23, 59, 0, 0);
  else {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  const text = to_datetime_input(date, false);
  return all_day ? text.slice(0, 10) : text;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

// An input that blocks its form with the message while it has one.
function CheckedInput({ error = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.setCustomValidity(error), [error]);
  return <input ref={ref} aria-invalid={error ? true : undefined} {...rest} />;
}

// A typed list, such as days of the month, read once it is left or Enter is pressed; it keeps what was typed while
// that has a problem, and shows the rule's list again whenever that changes.
function ListText({ label, shown, error, placeholder, on_commit }: { label: string; shown: string; error?: string; placeholder?: string; on_commit: (text: string) => void }) {
  const [text, set_text] = useState(shown);
  const [last_shown, set_last_shown] = useState(shown);
  if (shown !== last_shown) {
    set_last_shown(shown);
    set_text(shown);
  }
  return (
    <CheckedInput
      type="text"
      aria-label={label}
      placeholder={placeholder}
      autoComplete="off"
      error={error}
      value={text}
      onChange={(event) => set_text(event.currentTarget.value)}
      onBlur={() => on_commit(text)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        on_commit(text);
      }}
    />
  );
}

function Row({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={`field recurrence-${name}`} role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>{label}</span>
      <div className="chips">{children}</div>
    </div>
  );
}

// Repeated controls one under another, drawn only when there are some.
function List({ children }: { children: ReactNode[] }) {
  return children.length > 0 ? <div className="stack tight">{children}</div> : null;
}

function RemoveButton({ label, on_click }: { label: string; on_click: () => void }) {
  return <button type="button" className="icon remove" aria-label={label} onClick={on_click}>×</button>;
}

// ── Field ────────────────────────────────────────────────────────────────────

interface RecurrenceFieldProps {
  // A rule without its "RRULE:" prefix, such as "FREQ=WEEKLY;BYDAY=MO,WE", or "" when the item does not repeat; with
  // value_format "ical", RRULE, EXDATE and RDATE lines.
  value: string;
  on_change: (value: string) => void;
  // How much of the form to show: "simple", "standard" (the default) or "full", then features to add, or remove with a
  // leading "-", such as "standard -sub-daily".
  features?: string;
  value_format?: "rrule" | "ical";
  time_mode?: "utc" | "floating";
  // The event's start is a date without a time: dates are written as plain dates and times of day are hidden.
  all_day?: boolean;
  // The event's start, "YYYY-MM-DD" with an optional time, which day patterns default to.
  start?: string | null;
  weekday_format?: "short" | "narrow" | "long";
  disabled?: boolean;
  // Sends the value with its form under this name.
  name?: string;
  // The label of the switch that turns repeating on.
  label?: string;
}

// Problems block the field's form through its own inputs, so a form refuses to submit a rule it could not read.
export function RecurrenceField({ value, on_change, features: features_text, value_format = "rrule", time_mode = "utc", all_day = false, start, weekday_format = "short", disabled = false, name, label = "Repeats" }: RecurrenceFieldProps) {
  const ical = value_format === "ical";
  const format = { time_mode, all_day };
  const features = read_features(features_text);
  const key_for = (text: string) => [value_format, time_mode, all_day, text].join("\n");
  const [stored, set_state] = useState(() => load_state(value, ical, key_for(value)));
  let state = stored;
  if (stored.key !== key_for(value)) {
    state = load_state(value, ical, key_for(value));
    set_state(state);
  }

  const defaults = defaults_from(start);
  const options = state.options;
  const frequency = frequency_shown(options);
  const monthly_or_yearly = day_of_month_frequencies.includes(frequency);
  const weekdays = options.byweekday ?? [];
  const has_days = Boolean(options.bymonthday?.length);
  const day_mode: DayMode = has_days && weekdays.length ? "both" : has_days ? "days" : weekdays.length ? "weekdays" : "start";
  const end_type: EndType = options.until ? "until" : options.count ? "count" : "never";
  const date_input_type = all_day ? "date" : "datetime-local";
  const current_value = value_of(state, ical, format);

  // Applies one edit, starting a fresh rule when the value could not be read, and hands on the new value.
  function edit(change: (next: FieldState) => void): void {
    const next = state.load_error ? { ...empty_state(""), enabled: true, options: { freq: frequency_of("DAILY") } } : copy_state(state);
    change(next);
    const next_value = value_of(next, ical, format);
    next.key = key_for(next_value);
    set_state(next);
    if (next_value !== value) on_change(next_value);
  }

  // Changes the frequency and drops the parts RFC 5545 does not allow with it.
  function set_frequency(next: FieldState, name: FrequencyName): void {
    const draft = next.options;
    draft.freq = frequency_of(name);
    if (name !== "YEARLY") delete draft.byweekno;
    if (["DAILY", "WEEKLY", "MONTHLY"].includes(name)) delete draft.byyearday;
    if (name === "WEEKLY") delete draft.bymonthday;
    if (!day_of_month_frequencies.includes(name) && draft.byweekday) {
      set_list(draft, "byweekday", [...new Set(draft.byweekday.map(weekday_code))].map((code) => weekday_of(code)));
    }
    if (needs_month(draft)) draft.bymonth = [defaults.month];
  }

  function set_day_mode(next: FieldState, mode: DayMode): void {
    const draft = next.options;
    if (mode === "start" || mode === "weekdays") delete draft.bymonthday;
    if (mode === "start" || mode === "days") delete draft.byweekday;
    if (mode === "start") delete draft.bysetpos;
    if ((mode === "days" || mode === "both") && !draft.bymonthday) draft.bymonthday = [defaults.month_day];
    if ((mode === "weekdays" || mode === "both") && !draft.byweekday) draft.byweekday = [weekday_of(defaults.weekday, mode === "both" ? 0 : defaults.ordinal)];
    if (needs_month(draft)) draft.bymonth = [defaults.month];
  }

  // Reads a typed list into one BY part, or keeps a problem for the field when the part does not allow it.
  function apply_list_text(field: string, part: RulePart, text: string, limit = 0): void {
    edit((next) => {
      try {
        const values = parse_rule_part(part, text);
        if (limit && values.length > limit) throw new Error("Enter a single day of the month.");
        if (part === "byweekday" && (values as Weekday[]).some((entry) => entry.n) && !monthly_or_yearly) {
          throw new Error("Numbered weekdays such as -1FR only work in monthly and yearly rules.");
        }
        delete next.errors[field];
        set_list(next.options, part, values);
      } catch (error) {
        next.errors[field] = (error as Error).message;
      }
    });
  }

  // Reads the time rows into BYHOUR and BYMINUTE, which only hold times that share the same minutes in every hour.
  function read_times(next: FieldState, rows: string[]): void {
    next.times = rows;
    const times = [...new Set(rows.filter(Boolean))];
    const hours = [...new Set(times.map((time) => Number(time.slice(0, 2))))].sort((a, b) => a - b);
    const minutes = [...new Set(times.map((time) => Number(time.slice(3, 5))))].sort((a, b) => a - b);
    if (hours.length * minutes.length !== times.length) {
      next.errors.times = "One rule can only hold times that share the same minutes in every hour, such as 09:00 and 17:00.";
      return;
    }
    delete next.errors.times;
    set_list(next.options, "byhour", hours);
    set_list(next.options, "byminute", times.length > 0 ? minutes : []);
  }

  function set_entries(next: FieldState, entries: Weekday[]): void {
    set_list(next.options, "byweekday", [...new Map(entries.map((entry) => [entry.toString(), entry])).values()]);
  }

  function set_end(next: FieldState, type: EndType, count: number | null, until_text: string): void {
    delete next.options.count;
    delete next.options.until;
    if (type === "count") next.options.count = Math.max(1, count ?? 1);
    if (type === "until") next.options.until = rule_date_from_input(until_text || default_input("end", all_day), format);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  const shown = state.enabled && !state.load_error && !state.verbatim;
  const labels = weekday_labels[weekday_format] ?? weekday_labels.short;
  const plain_codes = new Set(weekdays.filter((entry) => !entry.n).map(weekday_code));
  const entry_count = monthly_or_yearly ? weekdays.length : 0;
  const entries = weekdays.slice(0, features.has("weekday-entries") ? entry_count : Math.min(entry_count, 1));
  const shown_times = (() => {
    if (state.times) return state.times;
    const minutes = options.byminute ?? [0];
    const times = (options.byhour ?? []).flatMap((hour) => minutes.map((minute) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)).sort();
    if (features.has("times")) return times;
    return [times[0] ?? ""];
  })();
  const positions = options.bysetpos ?? [];
  const set_position = positions.length === 0 ? "" : positions.length === 1 && ordinal_names.some(([position]) => position === String(positions[0])) ? String(positions[0]) : "custom";
  const show_set_position = monthly_or_yearly && day_mode !== "start" && features.has("set-position");
  const frequencies = frequency_units.filter(([unit]) => unit === frequency || !sub_daily_frequencies.includes(unit) || (!all_day && features.has("sub-daily")));
  const part_allowed: Partial<Record<RulePart, boolean>> = {
    byweekno: frequency === "YEARLY",
    byyearday: !["DAILY", "WEEKLY", "MONTHLY"].includes(frequency),
    bymonthday: frequency !== "WEEKLY",
  };

  // Only problems in fields on show count, so a hidden row never blocks the form.
  const visible_errors = [
    monthly_or_yearly && (day_mode === "days" || day_mode === "both") ? "month_days" : "",
    time_of_day_frequencies.includes(frequency) && !all_day ? "times" : "",
    frequency === "HOURLY" && !all_day && features.has("sub-daily") ? "hour_minutes" : "",
    frequency === "MINUTELY" && !all_day && features.has("sub-daily") ? "minute_seconds" : "",
    ...(features.has("more-options") ? Object.keys(rule_parts).filter((part) => part_allowed[part as RulePart] !== false) : []),
  ];
  const field_error = shown ? (visible_errors.map((field) => state.errors[field]).find(Boolean) ?? "") : "";
  const message = state.load_error || field_error;
  const extras = [...(options.extra_parts ?? []), ...state.extra_lines];
  const calendar_note = state.verbatim && state.enabled ? `This rule uses ${rule_calendar(options as RuleOptions)}, which this form cannot edit or calculate, so it is kept as written.` : "";
  const description = calendar_note || (current_value && !state.load_error ? describe_rule(current_value, format) : "");
  const kept_note = current_value && !calendar_note && extras.length > 0 ? `Also keeps, without calculating: ${extras.join("; ")}` : "";
  const summary = message || [description, kept_note].filter(Boolean).join(". ");

  const date_rows = (list: "exdates" | "rdates", row_label: string, add_label: string) => (
    <Row name={list} label={row_label}>
      <List>
        {state[list].map((date, index) => (
          <div key={index} className="chips">
            <input
              type={date_input_type}
              aria-label={list === "exdates" ? "Date to skip" : "Extra date"}
              value={input_from_rule_date(date, format)}
              onChange={(event) => {
                const text = event.currentTarget.value;
                if (text) edit((next) => { next[list][index] = rule_date_from_input(text, format); });
              }}
            />
            <RemoveButton label="Remove" on_click={() => edit((next) => { next[list].splice(index, 1); })} />
          </div>
        ))}
      </List>
      <button type="button" onClick={() => edit((next) => { next[list].push(rule_date_from_input(default_input("date", all_day), format)); })}>{add_label}</button>
    </Row>
  );

  return (
    <fieldset className="check-group recurrence-field" disabled={disabled}>
      {name && <input type="hidden" name={name} value={current_value} />}
      <label className="check">
        <CheckedInput
          type="checkbox"
          error={state.load_error}
          checked={state.enabled}
          onChange={(event) => {
            const enabled = event.currentTarget.checked;
            edit((next) => {
              next.enabled = enabled;
              if (enabled && next.options.freq === undefined) next.options.freq = frequency_of("DAILY");
            });
          }}
        />
        {label}
      </label>

      {shown && (
        <div className="stack tight">
          <Row name="repeat" label="Every">
            <NumberField label="Interval" bare min={1} value={options.interval ?? 1} on_change={(interval) => edit((next) => {
              if ((interval ?? 1) <= 1) delete next.options.interval;
              else next.options.interval = interval!;
            })} />
            <select aria-label="Unit" value={frequency} onChange={(event) => {
              const name = event.currentTarget.value as FrequencyName;
              edit((next) => set_frequency(next, name));
            }}>
              {frequencies.map(([unit, unit_label]) => <option key={unit} value={unit}>{unit_label}</option>)}
            </select>
          </Row>

          {(frequency === "WEEKLY" || (!monthly_or_yearly && features.has("filters"))) && (
            <Row name="weekdays" label={frequency === "WEEKLY" ? "On" : "Only on"}>
              <div className="segmented" role="group" aria-label="Weekdays">
                {display_weekday_codes.map((code) => (
                  <button key={code} type="button" aria-pressed={plain_codes.has(code)} aria-label={weekday_labels.long[code]} title={weekday_labels.long[code]} onClick={() => edit((next) => {
                    const picked = new Set(plain_codes);
                    if (picked.has(code)) picked.delete(code);
                    else picked.add(code);
                    set_list(next.options, "byweekday", rule_weekday_codes.filter((each) => picked.has(each)).map((each) => weekday_of(each)));
                  })}>
                    {labels[code]}
                  </button>
                ))}
              </div>
            </Row>
          )}

          {frequency === "YEARLY" && (
            <Row name="months" label="In">
              {month_names.map((month_name, index) => {
                const month = index + 1;
                const picked = (options.bymonth ?? []).includes(month);
                return (
                  <button key={month} type="button" aria-pressed={picked} aria-label={month_name} title={month_name} onClick={() => edit((next) => {
                    const months = picked ? (next.options.bymonth ?? []).filter((each) => each !== month) : features.has("months") ? [...(next.options.bymonth ?? []), month].sort((a, b) => a - b) : [month];
                    if (months.length === 0 && needs_month(next.options, true)) return;
                    set_list(next.options, "bymonth", months);
                  })}>
                    {month_name.slice(0, 3)}
                  </button>
                );
              })}
            </Row>
          )}

          {monthly_or_yearly && (
            <Row name="month-days" label="On">
              <select aria-label="Which days" value={day_mode} onChange={(event) => {
                const mode = event.currentTarget.value as DayMode;
                edit((next) => set_day_mode(next, mode));
              }}>
                <option value="start">the start's day</option>
                <option value="days">certain days of the month</option>
                <option value="weekdays">certain weekdays</option>
                {features.has("month-days") && features.has("weekday-entries") && <option value="both">certain days that fall on certain weekdays</option>}
              </select>
              {(day_mode === "days" || day_mode === "both") && (
                <ListText
                  label="Days of the month, -1 for the last"
                  placeholder="15, -1"
                  shown={(options.bymonthday ?? []).slice(0, features.has("month-days") ? undefined : 1).join(", ")}
                  error={state.errors.month_days}
                  on_commit={(text) => apply_list_text("month_days", "bymonthday", text, features.has("month-days") ? 0 : 1)}
                />
              )}
              {(day_mode === "weekdays" || day_mode === "both") && (
                <>
                  <List>
                    {entries.map((entry, index) => {
                      const ordinal = String(entry.n ?? "");
                      const ordinals = ordinal_names.some(([position]) => position === ordinal) ? ordinal_names : [...ordinal_names, [ordinal, `number ${ordinal}`] as [string, string]];
                      const replace = (position: number, code: WeekdayStr) => edit((next) => set_entries(next, entries.map((each, at) => (at === index ? weekday_of(code, position) : each))));
                      return (
                        <div key={index} className="chips">
                          <select aria-label="Which" value={ordinal} onChange={(event) => replace(Number(event.currentTarget.value), weekday_code(entry))}>
                            {ordinals.map(([position, position_label]) => <option key={position} value={position}>{position_label}</option>)}
                          </select>
                          <select aria-label="Weekday" value={weekday_code(entry)} onChange={(event) => replace(entry.n ?? 0, event.currentTarget.value as WeekdayStr)}>
                            {display_weekday_codes.map((code) => <option key={code} value={code}>{weekday_labels.long[code]}</option>)}
                          </select>
                          {features.has("weekday-entries") && <RemoveButton label="Remove" on_click={() => edit((next) => set_entries(next, entries.filter((_, at) => at !== index)))} />}
                        </div>
                      );
                    })}
                  </List>
                  {features.has("weekday-entries") && (
                    <button type="button" onClick={() => edit((next) => {
                      set_entries(next, [...(next.options.byweekday ?? []), weekday_of(defaults.weekday, defaults.ordinal)]);
                      if (needs_month(next.options)) next.options.bymonth = [defaults.month];
                    })}>
                      Add a weekday
                    </button>
                  )}
                </>
              )}
            </Row>
          )}

          {show_set_position && (
            <Row name="set-position" label="Use">
              <select aria-label="Which of the matching days" value={set_position} onChange={(event) => {
                const position = event.currentTarget.value;
                edit((next) => set_list(next.options, "bysetpos", position === "" ? [] : [Number(position)]));
              }}>
                <option value="">all of them</option>
                {ordinal_names.slice(1).map(([position, position_label]) => <option key={position} value={position}>only the {position_label}</option>)}
                <option value="custom" disabled>a custom set (see More options)</option>
              </select>
            </Row>
          )}

          {time_of_day_frequencies.includes(frequency) && !all_day && (
            <Row name="times" label="At">
              <List>
                {shown_times.map((time, index) => (
                  <div key={index} className="chips">
                    <CheckedInput type="time" aria-label="Time" value={time} error={index === 0 ? state.errors.times : ""} onChange={(event) => {
                      const text = event.currentTarget.value;
                      edit((next) => read_times(next, shown_times.map((each, at) => (at === index ? text : each))));
                    }} />
                    {features.has("times") && <RemoveButton label="Remove" on_click={() => edit((next) => read_times(next, shown_times.filter((_, at) => at !== index)))} />}
                  </div>
                ))}
              </List>
              {features.has("times") && (
                <button type="button" onClick={() => edit((next) => {
                  const hours = next.options.byhour ?? [];
                  const hour = hours.length > 0 ? (Math.max(...hours) + 1) % 24 : 9;
                  read_times(next, [...shown_times, `${String(hour).padStart(2, "0")}:${String(next.options.byminute?.[0] ?? 0).padStart(2, "0")}`]);
                })}>
                  Add a time
                </button>
              )}
            </Row>
          )}

          {frequency === "HOURLY" && !all_day && features.has("sub-daily") && (
            <Row name="hour-minutes" label="At">
              <ListText label="Minutes past the hour" placeholder="0, 30" shown={(options.byminute ?? []).join(", ")} error={state.errors.hour_minutes} on_commit={(text) => apply_list_text("hour_minutes", "byminute", text)} />
              <span>minutes past</span>
            </Row>
          )}

          {frequency === "MINUTELY" && !all_day && features.has("sub-daily") && (
            <Row name="minute-seconds" label="At">
              <ListText label="Seconds past the minute" placeholder="0, 30" shown={(options.bysecond ?? []).join(", ")} error={state.errors.minute_seconds} on_commit={(text) => apply_list_text("minute_seconds", "bysecond", text)} />
              <span>seconds past</span>
            </Row>
          )}

          <Row name="end" label="Ends">
            <select aria-label="How it ends" value={end_type} onChange={(event) => {
              const type = event.currentTarget.value as EndType;
              edit((next) => set_end(next, type, options.count ?? 1, ""));
            }}>
              <option value="never">never</option>
              <option value="count">after a number of times</option>
              <option value="until">on a date</option>
            </select>
            {end_type === "count" && <NumberField label="Number of times" bare min={1} value={options.count ?? 1} on_change={(count) => edit((next) => set_end(next, "count", count, ""))} />}
            {end_type === "until" && options.until && (
              <input type={date_input_type} aria-label="End date" value={input_from_rule_date(options.until, format)} onChange={(event) => {
                const text = event.currentTarget.value;
                if (text) edit((next) => set_end(next, "until", null, text));
              }} />
            )}
          </Row>

          {ical && features.has("exdates") && date_rows("exdates", "Except", "Skip a date")}
          {ical && features.has("exdates") && date_rows("rdates", "Also", "Add a date")}
        </div>
      )}

      {shown && features.has("more-options") && (
        <FormGroup summary="More options" class_name="recurrence-more">
          <div className="stack tight">
            {(Object.keys(rule_parts) as RulePart[]).filter((part) => part_allowed[part] !== false).map((part) => (
              <Row key={part} name="part" label={rule_parts[part].label}>
                <ListText
                  label={rule_parts[part].label}
                  shown={(options[part] ?? []).map(String).join(", ")}
                  error={state.errors[part]}
                  on_commit={(text) => apply_list_text(part, part, text)}
                />
              </Row>
            ))}
            <Row name="part" label="WKST">
              <select aria-label="Week starts on" value={options.wkst === undefined || options.wkst === null ? "" : weekday_code(options.wkst)} onChange={(event) => {
                const code = event.currentTarget.value as WeekdayStr | "";
                edit((next) => {
                  if (code) next.options.wkst = weekday_of(code);
                  else delete next.options.wkst;
                });
              }}>
                <option value="">Monday (default)</option>
                {display_weekday_codes.map((code) => <option key={code} value={code}>{weekday_labels.long[code]}</option>)}
              </select>
            </Row>
          </div>
        </FormGroup>
      )}

      {summary && <p className={message ? "small tone-bad field-error" : "muted small"} aria-live="polite">{summary}</p>}
    </fieldset>
  );
}
