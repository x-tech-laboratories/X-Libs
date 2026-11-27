// Dashboards a person builds from the data an app offers: the app describes its data sets, each a list of plain rows
// with named fields, and a card picks one, narrows it with a `filter` tree and a period, groups it by a field or by
// hours, days, weeks or months, splits each group by a second field, and measures every group as a count, sum,
// average, lowest, highest, distinct count or latest value. `run_card` works a card out over rows held in memory, for
// `web/react/dashboard` to draw as a number, chart or table; dashboards are plain JSON the app saves, and
// `clean_dashboards` reads them back from anywhere they may have been changed.

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  date_unit_milliseconds, evaluate, is_group, leaf, ranked_sets,
  type DateClock, type DateUnit, type FilterCatalogue, type FilterField, type FilterNode, type FilterRecord, type LeafNode, type RelativeDate,
} from "./filter.ts";

// ── Data sets ────────────────────────────────────────────────────────────────

export type DataValue = string | number | null;
export type DataRow = Readonly<Record<string, DataValue>>;
export type DataFieldKind = "text" | "number" | "time";

export interface DataField {
  id: string;
  label: string;
  kind: DataFieldKind;
  // How a time field is stored, milliseconds when not given.
  clock?: DateClock;
  // A text field's values in the order they are shown, such as statuses from good to bad; the rest follow by name.
  order?: readonly string[];
  // What a text field's values are called, where their stored form is not for reading.
  value_labels?: Readonly<Record<string, string>>;
  // The CSS color of a text field's values, such as a status token.
  colors?: Readonly<Record<string, string>>;
  // A number field's value as text, such as bytes or a percentage.
  format?: (value: number) => string;
}

export interface DataSet {
  id: string;
  label: string;
  fields: readonly DataField[];
  // The time field a card's period goes by and its latest value is picked by; a data set without one holds only the present.
  time_field?: string;
}

export function field_of_set(data_set: DataSet, id: string | null): DataField | undefined {
  return id === null ? undefined : data_set.fields.find((field) => field.id === id);
}

// ── Cards ────────────────────────────────────────────────────────────────────

export const measures = ["count", "sum", "average", "min", "max", "distinct", "latest"] as const;
export type Measure = (typeof measures)[number];

export const time_buckets = ["hour", "day", "week", "month"] as const;
export type TimeBucket = (typeof time_buckets)[number];

export const card_views = ["number", "bars", "stacked_bars", "line", "donut", "meters", "treemap", "table"] as const;
export type CardView = (typeof card_views)[number];

// A card worked out from a data set.
export interface ChartCard {
  id: string;
  kind: "chart";
  title: string;
  data_set: string;
  filter: FilterNode | null;
  // Only the rows whose time falls in the last so long.
  period: RelativeDate | null;
  group_by: string | null;
  // The span each group covers when grouping by a time field.
  bucket: TimeBucket | null;
  // A second field that splits every group into parts, such as a bar's stack or a chart's lines.
  split_by: string | null;
  measure: Measure;
  // The field measured; a count needs none.
  measure_field: string | null;
  sort: "group" | "value";
  descending: boolean;
  // The most groups shown.
  limit: number | null;
  view: CardView;
}

// A card the app draws itself, by the name it is registered under.
export interface ReadyCard {
  id: string;
  kind: "ready";
  name: string;
}

export type DashboardCard = ChartCard | ReadyCard;

// Where a card sits in the grid, as `web/react/card_grid` places it.
export interface DashboardPlace {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  name: string;
  cards: DashboardCard[];
  places: DashboardPlace[];
}

export function new_chart_card(id: string, data_set: DataSet): ChartCard {
  return {
    id, kind: "chart", title: data_set.label, data_set: data_set.id, filter: null, period: null, group_by: null, bucket: null, split_by: null,
    measure: "count", measure_field: null, sort: "group", descending: false, limit: null, view: "number",
  };
}

// Whether a measure reads a field, and so needs one picked.
export const measure_needs_field = (measure: Measure): boolean => measure !== "count";

// The views that can show a card as it is set up: a number when nothing is grouped, a line only over time, stacks only when split.
export function fitting_views(card: ChartCard, data_set: DataSet): CardView[] {
  if (card.group_by === null) return ["number"];
  const over_time = field_of_set(data_set, card.group_by)?.kind === "time";
  if (card.split_by !== null) return over_time ? ["stacked_bars", "line", "table"] : ["stacked_bars", "table"];
  return over_time ? ["bars", "line", "table"] : ["bars", "donut", "meters", "treemap", "table"];
}

// Why a card cannot be worked out, such as a field its data set no longer has, or null when it can.
export function card_problem(card: ChartCard, data_set: DataSet | undefined): string | null {
  if (!data_set) return "This card's data is no longer offered.";
  const named: [string, string | null][] = [["group", card.group_by], ["split", card.split_by], ["measure", card.measure_field]];
  for (const [role, id] of named) {
    if (id !== null && !field_of_set(data_set, id)) return `This card's ${role} field is no longer offered.`;
  }
  const missing = [...filter_fields(card.filter)].find((id) => !field_of_set(data_set, id));
  if (missing !== undefined) return "This card filters by a field that is no longer offered.";
  if (measure_needs_field(card.measure) && card.measure_field === null) return "Pick the field to measure.";
  if (card.measure === "latest" && !data_set.time_field) return "This data has no time to pick the latest by.";
  if (card.period !== null && !data_set.time_field) return "This data has no time to set a period by.";
  return null;
}

function filter_fields(node: FilterNode | null, into = new Set<string>()): Set<string> {
  if (node === null) return into;
  if (is_group(node)) node.children.forEach((child) => filter_fields(child, into));
  else into.add(node.field);
  return into;
}

// The fields a measure can read: numbers for the numeric measures, any field for a distinct count, none for a count.
export function measure_fields(data_set: DataSet, measure: Measure): DataField[] {
  if (measure === "count") return [];
  if (measure === "distinct") return [...data_set.fields];
  return data_set.fields.filter((field) => field.kind === "number");
}

// The measures a data set offers: the latest value only when it has a time to pick it by.
export function offered_measures(data_set: DataSet): Measure[] {
  return measures.filter((measure) => measure !== "latest" || data_set.time_field !== undefined);
}

// A card set straight after a change: a split and a span only where the grouping takes one, a measured field that fits the measure, and a view that fits.
export function settle_card(card: ChartCard, data_set: DataSet): ChartCard {
  const group = field_of_set(data_set, card.group_by);
  const group_by = group ? group.id : null;
  const bucket = group?.kind === "time" ? (card.bucket ?? "day") : null;
  const split = field_of_set(data_set, card.split_by);
  const split_by = group && split && split.kind === "text" && split.id !== group.id ? split.id : null;
  const measure = offered_measures(data_set).includes(card.measure) ? card.measure : "count";
  const fields = measure_fields(data_set, measure);
  const measure_field = fields.some((field) => field.id === card.measure_field) ? card.measure_field : (fields[0]?.id ?? null);
  const period = data_set.time_field ? card.period : null;
  const settled: ChartCard = { ...card, group_by, bucket, split_by, measure, measure_field, period };
  const views = fitting_views(settled, data_set);
  return views.includes(settled.view) ? settled : { ...settled, view: views[0]! };
}

// ── Conditions ───────────────────────────────────────────────────────────────

// The operators a condition offers on each kind of field.
export const condition_ops: Readonly<Record<DataFieldKind, readonly string[]>> = {
  text: ["is", "not_is", "contains", "starts", "ends", "empty", "defined"],
  number: ["is", "not_is", ">", "<", ">=", "<=", "empty", "defined"],
  time: ["in_last", "not_in_last", "empty", "defined"],
};

// Whether an operator compares with a value, which "is empty" and "is set" do not.
export const op_takes_value = (op: string): boolean => op !== "empty" && op !== "defined";

// A filter as a flat list of conditions joined by all or any of them.
export interface FlatFilter {
  join: "and" | "or";
  conditions: LeafNode[];
}

// A card's filter as a flat list when every part of it is a condition the editor offers on that field, or null when it is not one.
export function flat_filter(filter: FilterNode | null, data_set: DataSet): FlatFilter | null {
  if (filter === null) return { join: "and", conditions: [] };
  const [join, children] = is_group(filter) ? [filter.op, filter.children] : ["and" as const, [filter]];
  if (join === "not") return null;
  const conditions: LeafNode[] = [];
  for (const child of children) {
    if (is_group(child) || child.case_sensitive) return null;
    const field = field_of_set(data_set, child.field);
    if (!field || !condition_ops[field.kind].includes(child.op)) return null;
    conditions.push(child);
  }
  return { join, conditions };
}

// A flat list of conditions as the filter tree a card keeps, or null for none.
export function filter_of(flat: FlatFilter): FilterNode | null {
  return flat.conditions.length === 0 ? null : { op: flat.join, children: flat.conditions };
}

// A new condition on a field: its first operator with a value of the field's kind.
export function new_condition(field: DataField): LeafNode {
  const op = condition_ops[field.kind][0]!;
  if (field.kind === "time") return leaf(field.id, op, { count: 7, unit: "day" });
  return leaf(field.id, op, field.kind === "number" ? 0 : (known_values(field)[0] ?? ""));
}

// A text field's values the app names, in their order, for a condition to pick from.
export function known_values(field: DataField): string[] {
  if (field.kind !== "text") return [];
  return ordered_keys(field, [...(field.order ?? []), ...Object.keys(field.value_labels ?? {}), ...Object.keys(field.colors ?? {})]).filter((key): key is string => key !== null);
}

// ── Time ─────────────────────────────────────────────────────────────────────

// A time field's value as milliseconds, or null when it holds none.
export function milliseconds_of(value: DataValue, clock: DateClock = "milliseconds"): number | null {
  if (value === null || value === "") return null;
  const moment = clock === "iso" ? Date.parse(String(value)) : Number(value) * (clock === "seconds" ? 1000 : 1);
  return Number.isFinite(moment) ? moment : null;
}

// The local start of the hour, day, week from Monday, or month a moment falls in.
export function bucket_start(moment: number, bucket: TimeBucket): number {
  const date = new Date(moment);
  if (bucket === "hour") {
    date.setMinutes(0, 0, 0);
    return date.getTime();
  }
  date.setHours(0, 0, 0, 0);
  if (bucket === "week") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  if (bucket === "month") date.setDate(1);
  return date.getTime();
}

// The start of the span after the one that starts at `start`.
export function next_bucket(start: number, bucket: TimeBucket): number {
  if (bucket === "hour") return start + date_unit_milliseconds.hour;
  const date = new Date(start);
  if (bucket === "month") date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + (bucket === "week" ? 7 : 1));
  return date.getTime();
}

// The moment a period reaches back to from now.
export function period_start(now: number, period: RelativeDate): number {
  return now - period.count * date_unit_milliseconds[period.unit];
}

// ── Loading ──────────────────────────────────────────────────────────────────

// The data sets a dashboard's chart cards read, each with the longest period one of its cards needs, or null when one needs every row.
export function periods_needed(cards: readonly DashboardCard[]): Map<string, RelativeDate | null> {
  const needed = new Map<string, RelativeDate | null>();
  const span = (period: RelativeDate) => period.count * date_unit_milliseconds[period.unit];
  for (const card of cards) {
    if (card.kind !== "chart") continue;
    const before = needed.get(card.data_set);
    if (before === undefined || (before !== null && (card.period === null || span(card.period) > span(before)))) needed.set(card.data_set, card.period);
  }
  return needed;
}

// The earliest moment a load needs, for a data set's `since`, or null for every row.
export function since_of(period: RelativeDate | null, now: number): number | null {
  return period === null ? null : period_start(now, period);
}

// ── Working a card out ───────────────────────────────────────────────────────

export interface ResultPart {
  key: string | null;
  label: string;
  color: string | null;
  value: number | null;
}

export interface ResultGroup {
  // The group's value of the field, or for a span of time its start in milliseconds; null for the rows with none.
  key: string | number | null;
  label: string;
  color: string | null;
  // A span of time's start, in seconds as the charts take it.
  epoch: number | null;
  value: number | null;
  // The group's rows under each of the card's splits, in the splits' order.
  parts: ResultPart[];
}

export interface CardResult {
  groups: ResultGroup[];
  // The values the card splits by, in the order every group's parts follow.
  splits: { key: string | null; label: string; color: string | null }[];
  // The measure over every matching row.
  total: number | null;
  matching_rows: number;
}

const by_name = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function catalogue_of(data_set: DataSet): FilterCatalogue {
  const fields: Record<string, FilterField> = {};
  for (const field of data_set.fields) fields[field.id] = { kind: "column", column: field.id, clock: field.kind === "time" ? (field.clock ?? "milliseconds") : undefined };
  return { table: data_set.id, fields };
}

// The rows a card's filter and period keep.
export function matching_rows(data_set: DataSet, rows: readonly DataRow[], card: ChartCard, now: number): DataRow[] {
  const conditions: FilterNode[] = [];
  if (card.filter !== null) conditions.push(card.filter);
  if (card.period !== null && data_set.time_field) conditions.push(leaf(data_set.time_field, "in_last", card.period));
  if (conditions.length === 0) return [...rows];

  const node: FilterNode = { op: "and", children: conditions };
  const records: FilterRecord[] = rows.map((row, index) => ({ id: index, values: row }));
  const catalogue = catalogue_of(data_set);
  const context = { now, ranked: ranked_sets(node, records) };
  return records.filter((record) => evaluate(catalogue, node, record, context)).map((record) => rows[record.id as number]!);
}

function numbers_of(rows: readonly DataRow[], field: string): number[] {
  return rows.map((row) => row[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

// One measure over some rows; a sum of nothing is zero, and an average, lowest, highest or latest of nothing is null.
export function measure_rows(data_set: DataSet, rows: readonly DataRow[], measure: Measure, field: string | null): number | null {
  if (measure === "count") return rows.length;
  if (field === null) return null;
  if (measure === "distinct") return new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined)).size;
  if (measure === "latest") {
    const time = field_of_set(data_set, data_set.time_field ?? null);
    if (!time) return null;
    let latest: { moment: number; value: number } | null = null;
    for (const row of rows) {
      const moment = milliseconds_of(row[time.id] ?? null, time.clock);
      const value = row[field];
      if (moment === null || typeof value !== "number") continue;
      if (latest === null || moment >= latest.moment) latest = { moment, value };
    }
    return latest?.value ?? null;
  }

  const numbers = numbers_of(rows, field);
  if (measure === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (numbers.length === 0) return null;
  if (measure === "average") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return measure === "min" ? Math.min(...numbers) : Math.max(...numbers);
}

// A text field's values in its own order first, then by name, and the rows with none last.
function ordered_keys(field: DataField, keys: Iterable<string | null>): (string | null)[] {
  const place = new Map((field.order ?? []).map((key, index) => [key, index]));
  const present = [...new Set(keys)];
  const named = present.filter((key): key is string => key !== null);
  named.sort((first, second) => (place.get(first) ?? Infinity) - (place.get(second) ?? Infinity) || by_name.compare(first, second));
  return present.includes(null) ? [...named, null] : named;
}

const key_of = (row: DataRow, field: string): string | null => {
  const value = row[field];
  return value === null || value === undefined || value === "" ? null : String(value);
};

const label_of = (field: DataField, key: string | null): string => (key === null ? "None" : (field.value_labels?.[key] ?? key));
const color_of = (field: DataField, key: string | null): string | null => (key === null ? null : (field.colors?.[key] ?? null));

function members_by<Key>(rows: readonly DataRow[], key_of_row: (row: DataRow) => Key): Map<Key, DataRow[]> {
  const members = new Map<Key, DataRow[]>();
  for (const row of rows) {
    const key = key_of_row(row);
    const group = members.get(key);
    if (group) group.push(row);
    else members.set(key, [row]);
  }
  return members;
}

// The spans of time a card shows: from its period's start, or the earliest row, through the latest row or now.
function bucket_starts(moments: number[], card: ChartCard, bucket: TimeBucket, now: number): number[] {
  if (moments.length === 0 && card.period === null) return [];
  const first = bucket_start(card.period !== null ? period_start(now, card.period) : Math.min(...moments), bucket);
  const last = bucket_start(card.period !== null ? now : Math.max(...moments), bucket);
  const starts: number[] = [];
  for (let start = first; start <= last && starts.length < max_buckets; start = next_bucket(start, bucket)) starts.push(start);
  return starts;
}

// The most spans of time one card draws.
export const max_buckets = 1000;

function bucket_label(start: number, bucket: TimeBucket): string {
  const date = new Date(start);
  if (bucket === "hour") return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  if (bucket === "month") return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A card worked out over its data set's rows: its groups in order, each split into parts, and the measure over all of them.
export function run_card(data_set: DataSet, rows: readonly DataRow[], card: ChartCard, now: number): CardResult {
  const kept = matching_rows(data_set, rows, card, now);
  const measure = (members: readonly DataRow[]): number | null => measure_rows(data_set, members, card.measure, card.measure_field);
  const total = measure(kept);
  const group_field = field_of_set(data_set, card.group_by);
  if (!group_field) return { groups: [], splits: [], total, matching_rows: kept.length };

  const split_field = field_of_set(data_set, card.split_by);
  const split_keys = split_field ? ordered_keys(split_field, kept.map((row) => key_of(row, split_field.id))) : [];
  const splits = split_keys.map((key) => ({ key, label: label_of(split_field!, key), color: color_of(split_field!, key) }));
  const parts_of = (members: readonly DataRow[]): ResultPart[] => {
    if (!split_field) return [];
    const by_split = members_by(members, (row) => key_of(row, split_field.id));
    return splits.map((split) => ({ ...split, value: by_split.has(split.key) ? measure(by_split.get(split.key)!) : measure([]) }));
  };

  let groups: ResultGroup[];
  if (group_field.kind === "time") {
    const bucket = card.bucket ?? "day";
    const moment_of = (row: DataRow): number | null => milliseconds_of(row[group_field.id] ?? null, group_field.clock);
    const timed = kept.filter((row) => moment_of(row) !== null);
    const by_bucket = members_by(timed, (row) => bucket_start(moment_of(row)!, bucket));
    groups = bucket_starts(timed.map((row) => moment_of(row)!), card, bucket, now).map((start) => {
      const members = by_bucket.get(start) ?? [];
      return { key: start, label: bucket_label(start, bucket), color: null, epoch: start / 1000, value: measure(members), parts: parts_of(members) };
    });
    if (card.descending) groups.reverse();
  } else {
    const by_key = members_by(kept, (row) => key_of(row, group_field.id));
    groups = ordered_keys(group_field, by_key.keys()).map((key) => {
      const members = by_key.get(key)!;
      return { key, label: label_of(group_field, key), color: color_of(group_field, key), epoch: null, value: measure(members), parts: parts_of(members) };
    });
    if (card.sort === "value") groups.sort((first, second) => (first.value ?? -Infinity) - (second.value ?? -Infinity));
    if (card.descending) groups.reverse();
  }
  if (card.limit !== null) groups = groups.slice(0, Math.max(1, card.limit));
  return { groups, splits, total, matching_rows: kept.length };
}

// ── Reading saved dashboards ─────────────────────────────────────────────────

export const dashboard_limits = { dashboards: 50, cards: 100, text: 200, filter_depth: 8, filter_leaves: 100 };

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text_of = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value.slice(0, dashboard_limits.text) : null);
const one_of = <Choice extends string>(choices: readonly Choice[], value: unknown, otherwise: Choice): Choice =>
  choices.includes(value as Choice) ? (value as Choice) : otherwise;

const date_units = Object.keys(date_unit_milliseconds) as DateUnit[];

function clean_period(value: unknown): RelativeDate | null {
  if (!is_record(value) || typeof value.count !== "number" || !(value.count > 0) || !date_units.includes(value.unit as DateUnit)) return null;
  return { count: value.count, unit: value.unit as DateUnit };
}

function is_filter_value(value: unknown): boolean {
  if (value === undefined || value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every((entry) => typeof entry === "string" || typeof entry === "number");
  return clean_period(value) !== null;
}

// A filter tree with only the shapes `filter` knows, or null when any of it is not one.
function clean_filter(value: unknown, depth: number, budget: { leaves: number }): FilterNode | null {
  if (!is_record(value) || typeof value.op !== "string" || depth > dashboard_limits.filter_depth) return null;
  if (Array.isArray(value.children)) {
    if (!["and", "or", "not"].includes(value.op)) return null;
    const children = value.children.map((child) => clean_filter(child, depth + 1, budget));
    if (children.some((child) => child === null) || (value.op === "not" && children.length !== 1)) return null;
    return { op: value.op as "and" | "or" | "not", children: children as FilterNode[] };
  }
  if (typeof value.field !== "string" || !is_filter_value(value.value) || --budget.leaves < 0) return null;
  const node = leaf(value.field, value.op, value.value as never);
  return value.case_sensitive === true ? { ...node, case_sensitive: true } : node;
}

function clean_card(value: unknown): DashboardCard | null {
  if (!is_record(value)) return null;
  const id = text_of(value.id);
  if (id === null) return null;
  if (value.kind === "ready") {
    const name = text_of(value.name);
    return name === null ? null : { id, kind: "ready", name };
  }
  const data_set = text_of(value.data_set);
  if (value.kind !== "chart" || data_set === null) return null;
  const limit = typeof value.limit === "number" && value.limit >= 1 ? Math.floor(value.limit) : null;
  return {
    id, kind: "chart", title: text_of(value.title) ?? "", data_set,
    filter: value.filter == null ? null : clean_filter(value.filter, 0, { leaves: dashboard_limits.filter_leaves }),
    period: clean_period(value.period),
    group_by: text_of(value.group_by),
    bucket: value.bucket == null ? null : one_of(time_buckets, value.bucket, "day"),
    split_by: text_of(value.split_by),
    measure: one_of(measures, value.measure, "count"),
    measure_field: text_of(value.measure_field),
    sort: one_of(["group", "value"] as const, value.sort, "group"),
    descending: value.descending === true,
    limit,
    view: one_of(card_views, value.view, "number"),
  };
}

function clean_place(value: unknown): DashboardPlace | null {
  if (!is_record(value) || typeof value.id !== "string") return null;
  const cells = [value.x, value.y, value.w, value.h];
  if (!cells.every((cell) => typeof cell === "number" && Number.isFinite(cell) && cell >= 0)) return null;
  return { id: value.id, x: value.x as number, y: value.y as number, w: value.w as number, h: value.h as number };
}

function unique_by_id<Entry extends { id: string }>(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.id) && seen.add(entry.id));
}

// Saved dashboards as well-formed ones: anything that is not a dashboard, card or place is left out, and text and counts are kept within `dashboard_limits`.
export function clean_dashboards(value: unknown): Dashboard[] {
  if (!Array.isArray(value)) return [];
  const dashboards = value.slice(0, dashboard_limits.dashboards).flatMap((entry): Dashboard[] => {
    if (!is_record(entry)) return [];
    const id = text_of(entry.id);
    if (id === null) return [];
    const raw_cards = Array.isArray(entry.cards) ? entry.cards.slice(0, dashboard_limits.cards) : [];
    const cards = unique_by_id(raw_cards.map(clean_card).filter((card): card is DashboardCard => card !== null));
    const card_ids = new Set(cards.map((card) => card.id));
    const raw_places = Array.isArray(entry.places) ? entry.places : [];
    const places = unique_by_id(raw_places.map(clean_place).filter((place): place is DashboardPlace => place !== null && card_ids.has(place.id)));
    return [{ id, name: text_of(entry.name) ?? "Dashboard", cards, places }];
  });
  return unique_by_id(dashboards);
}
