// Filters as one JSON tree of conditions joined by and, or and not, over fields the app describes in a catalogue: each
// field a column of the app's table, an SQL expression over a row, a related table matched when any of its rows
// matches, or a set of values in a link table. The same tree runs as parameterised SQL through `filter_sql` and here as
// a check of one record held in memory, and the two give the same answer, which X-Libs' property test holds them to.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { Table } from "drizzle-orm";

import type { SqlValue } from "./sql.ts";

// ── The tree ─────────────────────────────────────────────────────────────────

export type ScalarOp =
  | "is"
  | "not_is"
  | "contains"
  | "starts"
  | "ends"
  | "regex"
  | ">"
  | "<"
  | ">="
  | "<="
  | "between"
  | "not_between"
  | "top"
  | "bottom"
  | "empty"
  | "defined";

export type SetOp = "any" | "all" | "none" | "count";
export type DateOp = "before" | "after" | "in_last" | "not_in_last";

// Another saved filter, by id, as part of this one.
export type ReferenceOp = "in_filter";

// The operators X-Libs knows, and any the catalogue adds by name.
export type LeafOp = ScalarOp | SetOp | DateOp | ReferenceOp | (string & {});

export type DateUnit = "hour" | "day" | "week" | "month" | "year";

export interface RelativeDate {
  count: number;
  unit: DateUnit;
}

export type FilterValue = string | number | boolean | null | readonly string[] | readonly number[] | RelativeDate;

export interface LeafNode {
  field: string;
  op: LeafOp;
  value?: FilterValue;
  // Text operators fold ASCII case unless this is true.
  case_sensitive?: boolean;
}

export interface GroupNode {
  op: "and" | "or" | "not";
  children: readonly FilterNode[];
}

export type FilterNode = LeafNode | GroupNode;

export interface SortKey {
  // A field of the catalogue, or "random" for a shuffled order.
  field: string;
  descending?: boolean;
}

export const random_field = "random";

export const is_group = (node: FilterNode): node is GroupNode => (node as GroupNode).children !== undefined;

export const and = (...children: FilterNode[]): GroupNode => ({ op: "and", children });
export const or = (...children: FilterNode[]): GroupNode => ({ op: "or", children });
export const not = (child: FilterNode): GroupNode => ({ op: "not", children: [child] });
export const leaf = (field: string, op: LeafOp, value?: FilterValue): LeafNode => (value === undefined ? { field, op } : { field, op, value });

// Every field the filter names, such as to check them against the catalogue.
export function referenced_fields(node: FilterNode, into = new Set<string>()): Set<string> {
  if (is_group(node)) node.children.forEach((child) => referenced_fields(child, into));
  else into.add(node.field);
  return into;
}

// The chain of saved filters that leads back to `id`, or null, so a filter that would contain itself is refused before it is saved.
export function find_cycle(id: string, node: FilterNode, resolve: (id: string) => FilterNode | undefined, seen: readonly string[] = []): string[] | null {
  if (is_group(node)) {
    for (const child of node.children) {
      const cycle = find_cycle(id, child, resolve, seen);
      if (cycle) return cycle;
    }
    return null;
  }
  if (node.op !== "in_filter" || typeof node.value !== "string") return null;

  const reference = node.value;
  if (reference === id || seen.includes(reference)) return [...seen, reference];

  const target = resolve(reference);
  return target ? find_cycle(id, target, resolve, [...seen, reference]) : null;
}

// ── The catalogue ────────────────────────────────────────────────────────────

// A column by its SQL name or as a Drizzle column.
export type ColumnName = string | { readonly name: string };

// A table by its SQL name or as a Drizzle table.
export type TableName = string | Table;

// How a date field is stored, so "in the last 30 days" compares like with like.
export type DateClock = "milliseconds" | "seconds" | "iso";

export interface ColumnField {
  kind: "column";
  column: ColumnName;
  clock?: DateClock;
}

// A value worked out in SQL from the row, which `row` names, such as a name looked up in another table.
export interface ExpressionField {
  kind: "expression";
  sql: (row: string) => string;
  clock?: DateClock;
}

export interface OrderColumn {
  column: ColumnName;
  descending?: boolean;
}

// A column of rows in another table that point at the row, such as a track's files; the row matches when any of them does.
export interface RelatedField {
  kind: "related";
  table: TableName;
  foreign_key: ColumnName;
  column: ColumnName;
  // The order that picks one of them to sort and group by, best first; end it with a unique column so the pick never varies.
  prefer?: readonly OrderColumn[];
  clock?: DateClock;
}

// Values kept once in their own table, which the link table points at by id.
export interface SetValues {
  table: TableName;
  id_column: ColumnName;
  value_column: ColumnName;
  // Further columns that pick this field's values out of a table several fields share.
  where?: Readonly<Record<string, SqlValue>>;
  // What groups sort by instead of the value, such as "Beatles, The".
  sort_column?: ColumnName;
}

// Several values per row in a link table, such as a track's genres.
export interface SetField {
  kind: "set";
  table: TableName;
  row_column: ColumnName;
  // The value itself, or the id of one in `values`.
  value_column: ColumnName;
  where?: Readonly<Record<string, SqlValue>>;
  values?: SetValues;
  // The order of a row's values, whose first one a sort uses.
  order_column?: ColumnName;
}

// A field whose conditions the app writes itself, in SQL and in memory.
export interface CustomField {
  kind: "custom";
  sql: (node: LeafNode, context: SqlContext) => string;
  evaluate?: (record: FilterRecord, node: LeafNode, context: EvaluateContext) => boolean;
  // The value to sort and group by, from the row `row` names.
  order?: (row: string) => string;
}

export type FilterField = ColumnField | ExpressionField | RelatedField | SetField | CustomField;

// An operator of the app's own, such as full-text search or membership of a playlist, that any leaf may use.
export interface CustomOperator {
  sql: (node: LeafNode, context: SqlContext) => string;
  evaluate?: (record: FilterRecord, node: LeafNode, context: EvaluateContext) => boolean;
}

export interface FilterCatalogue {
  table: TableName;
  // The table's id column, "id" when not given; sorted lists break ties by it.
  id_column?: ColumnName;
  fields: Readonly<Record<string, FilterField>>;
  operators?: Readonly<Record<string, CustomOperator>>;
}

// What a custom field or operator gets to write its SQL.
export interface SqlContext {
  // The alias of the row being tested, such as "t".
  row: string;
  // The row's id, such as `t."id"`.
  row_id: string;
  // Adds a value to the query's parameters and gives back its placeholder.
  param: (value: FilterValue | SqlValue | undefined) => string;
  // The SQL of a column or expression field's value on the row.
  field_sql: (field: string) => string;
}

export const define_catalogue = (catalogue: FilterCatalogue): FilterCatalogue => catalogue;

export function field_of(catalogue: FilterCatalogue, name: string): FilterField {
  const field = catalogue.fields[name];
  if (!field) throw new Error(`unknown field: ${name}`);
  return field;
}

// ── Records in memory ────────────────────────────────────────────────────────

export type FilterScalar = string | number | null;
export type RecordId = string | number;

// One row as held in memory: a column or expression field's value, a set field's values in their order, or a related field's value in each related row, best first.
export interface FilterRecord {
  id: RecordId;
  values: Readonly<Record<string, FilterScalar | readonly FilterScalar[] | undefined>>;
}

export interface EvaluateContext {
  now: number;
  // The ids `top` and `bottom` pick, keyed by `ranked_key`; `ranked_sets` makes them.
  ranked?: ReadonlyMap<string, ReadonlySet<RecordId>>;
  // The saved filter an `in_filter` leaf names.
  resolve?: (id: string) => FilterNode | undefined;
}

// ── Shared rules ─────────────────────────────────────────────────────────────

// A month counts as 30 days and a year as 365.
export const date_unit_milliseconds: Readonly<Record<DateUnit, number>> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

// The moment "in the last" a span starts, written as the field stores dates.
export function date_cutoff(now: number, span: FilterValue | undefined, clock: DateClock = "milliseconds"): number | string {
  const { count, unit } = relative_date(span);
  const moment = now - count * date_unit_milliseconds[unit];
  if (clock === "seconds") return moment / 1000;
  if (clock === "iso") return new Date(moment).toISOString();
  return moment;
}

export function relative_date(value: FilterValue | undefined): RelativeDate {
  const date = value as RelativeDate | undefined;
  if (!date || typeof date !== "object" || typeof date.count !== "number" || !(date.unit in date_unit_milliseconds)) {
    throw new Error("a relative date needs a count and a unit");
  }
  return date;
}

export function bounds(value: FilterValue | undefined): readonly [string | number, string | number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error("between needs a low and a high value");
  return value as unknown as readonly [string | number, string | number];
}

// SQLite takes no booleans, so true and false are compared as 1 and 0 on both sides.
export const plain_value = (value: unknown): unknown => (value === true ? 1 : value === false ? 0 : value);

export const ranked_key = (field: string, op: "top" | "bottom", count: number): string => `${field}:${op}:${count}`;

export const is_scalar_field = (field: FilterField): field is ColumnField | ExpressionField => field.kind === "column" || field.kind === "expression";

// ── Evaluating in memory ─────────────────────────────────────────────────────

// SQLite's LIKE folds ASCII letters only, so this does too.
function ascii_lower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function compare(left: FilterScalar, right: unknown): number | null {
  if (left === null || right === null || right === undefined) return null;
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : left > right ? 1 : 0;
  const left_text = String(left);
  const right_text = String(right);
  return left_text < right_text ? -1 : left_text > right_text ? 1 : 0;
}

function pattern_matches(pattern: unknown, text: string): boolean {
  try {
    return new RegExp(String(pattern), "u").test(text);
  } catch {
    return false;
  }
}

function scalar_of(record: FilterRecord, name: string): FilterScalar {
  const value = record.values[name];
  return Array.isArray(value) ? ((value[0] as FilterScalar | undefined) ?? null) : ((value as FilterScalar | undefined) ?? null);
}

function list_of(record: FilterRecord, name: string): readonly FilterScalar[] {
  const value = record.values[name];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value as FilterScalar];
}

function evaluate_set(record: FilterRecord, name: string, node: LeafNode): boolean {
  const have = list_of(record, name);
  const want = (Array.isArray(node.value) ? node.value : [node.value]) as FilterScalar[];

  switch (node.op) {
    case "any":
      return want.some((value) => have.includes(value));
    case "all":
      return want.every((value) => have.includes(value));
    case "none":
      return !want.some((value) => have.includes(value));
    case "count":
      return have.length === Number(node.value);
    case "empty":
      return have.length === 0;
    case "defined":
      return have.length > 0;
    default:
      throw new Error(`operator ${node.op} is not valid on set field ${name}`);
  }
}

function apply_op(raw: FilterScalar, node: LeafNode, clock: DateClock | undefined, context: EvaluateContext): boolean {
  const value = plain_value(node.value);
  const fold = (text: string): string => (node.case_sensitive ? text : ascii_lower(text));
  const text = raw === null ? null : String(raw);
  const order = (): number | null => compare(raw, value);

  switch (node.op) {
    case "is":
      return order() === 0;
    // SQL's IS NOT is true when exactly one side is null.
    case "not_is":
      return !(raw === null && (value === null || value === undefined)) && order() !== 0;
    case "contains":
      return text !== null && fold(text).includes(fold(String(value)));
    case "starts":
      return text !== null && fold(text).startsWith(fold(String(value)));
    case "ends":
      return text !== null && fold(text).endsWith(fold(String(value)));
    case "regex":
      return text !== null && pattern_matches(value, text);
    case ">":
    case "after":
      return (order() ?? 0) > 0;
    case "<":
    case "before":
      return (order() ?? 0) < 0;
    case ">=":
      return order() !== null && order()! >= 0;
    case "<=":
      return order() !== null && order()! <= 0;
    case "between":
    case "not_between": {
      const [low, high] = bounds(node.value);
      const from_low = compare(raw, low);
      const to_high = compare(raw, high);
      if (from_low === null || to_high === null) return false;
      return (from_low >= 0 && to_high <= 0) === (node.op === "between");
    }
    case "empty":
      return raw === null || raw === "";
    case "defined":
      return raw !== null && raw !== "";
    case "in_last": {
      const since = compare(raw, date_cutoff(context.now, node.value, clock));
      return since !== null && since >= 0;
    }
    case "not_in_last":
      return raw === null || (compare(raw, date_cutoff(context.now, node.value, clock)) ?? 0) < 0;
    default:
      throw new Error(`operator ${node.op} is not valid on field ${node.field}`);
  }
}

function evaluate_leaf(catalogue: FilterCatalogue, node: LeafNode, record: FilterRecord, context: EvaluateContext, seen: readonly string[]): boolean {
  if (node.op === "in_filter") {
    const id = String(node.value);
    if (seen.includes(id)) throw new Error(`filter ${id} contains itself`);
    const target = context.resolve?.(id);
    if (!target) throw new Error(`no saved filter ${id}`);
    return evaluate_node(catalogue, target, record, context, [...seen, id]);
  }

  const operator = catalogue.operators?.[node.op];
  if (operator) {
    if (!operator.evaluate) throw new Error(`operator ${node.op} works only in SQL`);
    return operator.evaluate(record, node, context);
  }

  const field = field_of(catalogue, node.field);
  if (field.kind === "custom") {
    if (!field.evaluate) throw new Error(`field ${node.field} works only in SQL`);
    return field.evaluate(record, node, context);
  }
  if (field.kind === "set") return evaluate_set(record, node.field, node);

  if (node.op === "top" || node.op === "bottom") {
    if (!is_scalar_field(field)) throw new Error(`operator ${node.op} is not valid on field ${node.field}`);
    return context.ranked?.get(ranked_key(node.field, node.op as "top" | "bottom", Number(node.value)))?.has(record.id) ?? false;
  }

  if (field.kind === "related") return list_of(record, node.field).some((raw) => apply_op(raw, node, field.clock, context));
  return apply_op(scalar_of(record, node.field), node, field.clock, context);
}

function evaluate_node(catalogue: FilterCatalogue, node: FilterNode, record: FilterRecord, context: EvaluateContext, seen: readonly string[]): boolean {
  if (!is_group(node)) return evaluate_leaf(catalogue, node, record, context, seen);

  switch (node.op) {
    case "and":
      return node.children.every((child) => evaluate_node(catalogue, child, record, context, seen));
    case "or":
      return node.children.some((child) => evaluate_node(catalogue, child, record, context, seen));
    case "not":
      if (node.children.length !== 1) throw new Error("not takes exactly one child");
      return !evaluate_node(catalogue, node.children[0]!, record, context, seen);
  }
}

// Whether one record matches, with the same answer the SQL gives for its row.
export function evaluate(catalogue: FilterCatalogue, node: FilterNode, record: FilterRecord, context: EvaluateContext): boolean {
  return evaluate_node(catalogue, node, record, context, []);
}

// ── Ranking ──────────────────────────────────────────────────────────────────

const compare_ids = (left: RecordId, right: RecordId): number => compare(left, right) ?? 0;

// The ids with the highest and the lowest values of a field, ties going by id as in SQL.
export function rank_records(records: readonly FilterRecord[], field: string, count: number): { top: Set<RecordId>; bottom: Set<RecordId> } {
  const with_value = records.map((record) => ({ id: record.id, value: scalar_of(record, field) })).filter((entry) => entry.value !== null);
  const ascending = [...with_value].sort((left, right) => (compare(left.value, right.value) ?? 0) || compare_ids(left.id, right.id));
  const descending = [...with_value].sort((left, right) => -(compare(left.value, right.value) ?? 0) || compare_ids(left.id, right.id));
  return { top: new Set(descending.slice(0, count).map((entry) => entry.id)), bottom: new Set(ascending.slice(0, count).map((entry) => entry.id)) };
}

// Every `top` and `bottom` the filter asks for, ranked over the records given, which should be the whole table.
export function ranked_sets(
  node: FilterNode,
  records: readonly FilterRecord[],
  resolve?: (id: string) => FilterNode | undefined,
  into = new Map<string, ReadonlySet<RecordId>>(),
  seen: readonly string[] = [],
): Map<string, ReadonlySet<RecordId>> {
  if (is_group(node)) {
    for (const child of node.children) ranked_sets(child, records, resolve, into, seen);
  } else if (node.op === "top" || node.op === "bottom") {
    const count = Number(node.value);
    const ranks = rank_records(records, node.field, count);
    into.set(ranked_key(node.field, "top", count), ranks.top);
    into.set(ranked_key(node.field, "bottom", count), ranks.bottom);
  } else if (node.op === "in_filter" && resolve && !seen.includes(String(node.value))) {
    const target = resolve(String(node.value));
    if (target) ranked_sets(target, records, resolve, into, [...seen, String(node.value)]);
  }
  return into;
}

// The ids of the records that match, in their order or sorted as the SQL sorts them.
export function select_ids(
  catalogue: FilterCatalogue,
  node: FilterNode,
  records: readonly FilterRecord[],
  options: { now: number; resolve?: (id: string) => FilterNode | undefined; sort?: readonly SortKey[] },
): RecordId[] {
  const context: EvaluateContext = { now: options.now, resolve: options.resolve, ranked: ranked_sets(node, records, options.resolve) };
  const matching = records.filter((record) => evaluate(catalogue, node, record, context));
  return (options.sort?.length ? sort_records(catalogue, matching, options.sort) : matching).map((record) => record.id);
}

// ── Sorting in memory ────────────────────────────────────────────────────────

// SQLite's order of two values: numbers before text, and text by code point as its UTF-8 bytes sort.
export function compare_sql_values(left: FilterScalar | RecordId, right: FilterScalar | RecordId): number {
  if (left === null || right === null) return (left === null ? 0 : 1) - (right === null ? 0 : 1);
  if (typeof left === "number" || typeof right === "number") {
    if (typeof left !== "number") return 1;
    if (typeof right !== "number") return -1;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const left_points = [...left];
  const right_points = [...right];
  for (let index = 0; index < Math.min(left_points.length, right_points.length); index++) {
    const difference = left_points[index]!.codePointAt(0)! - right_points[index]!.codePointAt(0)!;
    if (difference !== 0) return Math.sign(difference);
  }
  return Math.sign(left_points.length - right_points.length);
}

// The one value a record sorts by: a related field's first value, so the record lists them best first as `prefer`
// orders them, and a set's first value, or its smallest when the set has no `order_column`.
function sort_value(catalogue: FilterCatalogue, record: FilterRecord, name: string): FilterScalar {
  const field = field_of(catalogue, name);
  if (field.kind !== "set" || field.order_column) return scalar_of(record, name);
  const present = list_of(record, name).filter((value) => value !== null);
  return present.length ? present.reduce((smallest, value) => (compare_sql_values(value, smallest) < 0 ? value : smallest)) : null;
}

// The records in the order `compile_filter` gives their rows: missing values last either way, ties by id.
export function sort_records(catalogue: FilterCatalogue, records: readonly FilterRecord[], sort: readonly SortKey[]): FilterRecord[] {
  const keyed = records.map((record) => ({
    record,
    keys: sort.map((key) => (key.field === random_field && !catalogue.fields[random_field] ? Math.random() : sort_value(catalogue, record, key.field))),
  }));

  keyed.sort((left, right) => {
    for (const [index, key] of sort.entries()) {
      const left_value = left.keys[index]!;
      const right_value = right.keys[index]!;
      if (left_value === null || right_value === null) {
        if (left_value !== right_value) return left_value === null ? 1 : -1;
        continue;
      }
      const order = compare_sql_values(left_value, right_value);
      if (order !== 0) return key.descending ? -order : order;
    }
    return compare_sql_values(left.record.id, right.record.id);
  });
  return keyed.map((entry) => entry.record);
}

// ── A stack of filters ───────────────────────────────────────────────────────

export interface FilterChip {
  id: string;
  label: string;
  node: FilterNode;
  removable: boolean;
}

// The filters a view shows as removable chips, all applying at once; `version` counts changes for a page to redraw by.
export class FilterStack {
  private chips: FilterChip[] = [];
  version = 0;

  list(): readonly FilterChip[] {
    return this.chips;
  }

  // Adds a chip, replacing one with the same id.
  push(chip: FilterChip): void {
    this.chips = [...this.chips.filter((existing) => existing.id !== chip.id), chip];
    this.version++;
  }

  remove(id: string): void {
    this.chips = this.chips.filter((chip) => chip.id !== id);
    this.version++;
  }

  // Takes away every removable chip.
  clear(): void {
    this.chips = this.chips.filter((chip) => !chip.removable);
    this.version++;
  }

  // The chips as one filter; no chips match everything.
  to_filter(): FilterNode {
    const nodes = this.chips.map((chip) => chip.node).filter((node) => !(is_group(node) && node.children.length === 0));
    return nodes.length === 1 ? nodes[0]! : and(...nodes);
  }
}
