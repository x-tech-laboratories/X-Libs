// A `filter` tree as one parameterised SQLite query over the app's table, for any `SqlDatabase`: every value the filter
// holds goes in as a parameter, a missing value never turns a negated condition into "unknown", and a sorted list
// breaks ties by id so it reads the same each time and pages cleanly. Tables and columns are named as in the app's
// Drizzle schema, by name or as the schema's own objects; Drizzle cannot build these queries, so they are raw SQL.

// ── Imports ──────────────────────────────────────────────────────────────────

import { getTableName, type Table } from "drizzle-orm";

import {
  bounds,
  date_cutoff,
  field_of,
  is_group,
  is_scalar_field,
  plain_value,
  random_field,
  type ColumnName,
  type FilterCatalogue,
  type FilterField,
  type FilterNode,
  type FilterValue,
  type LeafNode,
  type OrderColumn,
  type SetField,
  type SortKey,
  type SqlContext,
  type TableName,
} from "./filter.ts";
import type { SqlDatabase, SqlValue } from "./sql.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface CompiledQuery {
  sql: string;
  params: SqlValue[];
}

export interface FilterQueryOptions {
  sort?: readonly SortKey[];
  limit?: number;
  offset?: number;
  // What each row gives back, from the row `row` names; its id alone when not given.
  select?: (row: string) => string;
  // The moment "in the last" counts back from, now when not given.
  now?: number;
  // The saved filter an `in_filter` leaf names.
  resolve?: (id: string) => FilterNode | undefined;
}

export interface GroupQueryOptions {
  // Totals per group by alias, each of a column or expression field, such as `{ total_ms: "length" }`.
  sums?: Readonly<Record<string, string>>;
  now?: number;
  resolve?: (id: string) => FilterNode | undefined;
}

// One group's row: its id and label, how many rows it holds, and each sum by its alias.
export interface GroupRow {
  group_id: SqlValue;
  label: SqlValue;
  count: number;
  [sum: string]: SqlValue;
}

// ── Names ────────────────────────────────────────────────────────────────────

const row_alias = "t";

export function quote_name(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const column_name = (column: ColumnName): string => (typeof column === "string" ? column : column.name);
const table_name = (table: TableName): string => (typeof table === "string" ? table : getTableName(table as Table));
const column_of = (alias: string, column: ColumnName): string => `${alias}.${quote_name(column_name(column))}`;
const table_as = (table: TableName, alias: string): string => `${quote_name(table_name(table))} ${alias}`;

// ── Compiling ────────────────────────────────────────────────────────────────

class Compiler {
  readonly params: SqlValue[] = [];
  readonly catalogue: FilterCatalogue;
  readonly now: number;
  readonly resolve: ((id: string) => FilterNode | undefined) | undefined;

  constructor(catalogue: FilterCatalogue, now: number, resolve?: (id: string) => FilterNode | undefined) {
    this.catalogue = catalogue;
    this.now = now;
    this.resolve = resolve;
  }

  id_of(alias: string): string {
    return column_of(alias, this.catalogue.id_column ?? "id");
  }

  param(value: FilterValue | SqlValue | undefined): string {
    const plain = plain_value(value);
    if (plain !== null && typeof plain === "object" && !(plain instanceof Uint8Array)) throw new Error("a filter value here must be a single value");
    this.params.push((plain ?? null) as SqlValue);
    return "?";
  }

  context(alias: string): SqlContext {
    return { row: alias, row_id: this.id_of(alias), param: (value) => this.param(value), field_sql: (name) => this.scalar(name, alias) };
  }

  scalar(name: string, alias: string): string {
    const field = field_of(this.catalogue, name);
    if (field.kind === "column") return column_of(alias, field.column);
    if (field.kind === "expression") return `(${field.sql(alias)})`;
    throw new Error(`field ${name} has no single value`);
  }

  where_of(alias: string, where: Readonly<Record<string, SqlValue>> | undefined): string {
    return Object.entries(where ?? {})
      .map(([column, value]) => ` AND ${column_of(alias, column)} = ${this.param(value)}`)
      .join("");
  }

  // The value or values a set field's link row holds, matched against one value.
  set_member(field: SetField, value: FilterValue): string {
    const link_where = this.where_of("link", field.where);
    const link_value = column_of("link", field.value_column);
    const values = field.values;
    const match = values
      ? `${link_value} IN (SELECT value_row.${quote_name(column_name(values.id_column))} FROM ${table_as(values.table, "value_row")} WHERE ${column_of("value_row", values.value_column)} = ${this.param(value)}${this.where_of("value_row", values.where)})`
      : `${link_value} = ${this.param(value)}`;
    return `EXISTS (SELECT 1 FROM ${table_as(field.table, "link")} WHERE ${column_of("link", field.row_column)} = ${this.id_of(row_alias)}${link_where} AND ${match})`;
  }

  set_rows(field: SetField): string {
    return `(SELECT COUNT(*) FROM ${table_as(field.table, "link")} WHERE ${column_of("link", field.row_column)} = ${this.id_of(row_alias)}${this.where_of("link", field.where)})`;
  }

  set_predicate(name: string, field: SetField, node: LeafNode): string {
    const values = (Array.isArray(node.value) ? node.value : [node.value]) as FilterValue[];
    switch (node.op) {
      case "any":
        return values.length ? `(${values.map((value) => this.set_member(field, value)).join(" OR ")})` : "0";
      case "all":
        return values.length ? `(${values.map((value) => this.set_member(field, value)).join(" AND ")})` : "1";
      case "none":
        return values.length ? `NOT (${values.map((value) => this.set_member(field, value)).join(" OR ")})` : "1";
      case "count":
        return `${this.set_rows(field)} = ${this.param(Number(node.value))}`;
      case "empty":
        return `${this.set_rows(field)} = 0`;
      case "defined":
        return `${this.set_rows(field)} > 0`;
      default:
        throw new Error(`operator ${node.op} is not valid on set field ${name}`);
    }
  }

  // LIKE always folds ASCII case, so a case-sensitive match uses GLOB, each with its wildcards in the text escaped.
  text_match(expression: string, text: string, any_before: boolean, any_after: boolean, case_sensitive: boolean): string {
    if (case_sensitive) {
      const pattern = text.replace(/[[*?]/g, (character) => `[${character}]`);
      return `${expression} GLOB ${this.param(`${any_before ? "*" : ""}${pattern}${any_after ? "*" : ""}`)}`;
    }
    const pattern = text.replace(/[\\%_]/g, (character) => `\\${character}`);
    return `${expression} LIKE ${this.param(`${any_before ? "%" : ""}${pattern}${any_after ? "%" : ""}`)} ESCAPE '\\'`;
  }

  apply_op(expression: string, node: LeafNode, field: FilterField): string {
    const value = node.value;
    const clock = "clock" in field ? field.clock : undefined;
    const case_sensitive = node.case_sensitive ?? false;

    switch (node.op) {
      case "is":
        return `${expression} = ${this.param(value)}`;
      case "not_is":
        return `${expression} IS NOT ${this.param(value)}`;
      case "contains":
        return this.text_match(expression, String(value), true, true, case_sensitive);
      case "starts":
        return this.text_match(expression, String(value), false, true, case_sensitive);
      case "ends":
        return this.text_match(expression, String(value), true, false, case_sensitive);
      case "regex":
        return `${expression} REGEXP ${this.param(value)}`;
      case ">":
      case "after":
        return `${expression} > ${this.param(value)}`;
      case "<":
      case "before":
        return `${expression} < ${this.param(value)}`;
      case ">=":
        return `${expression} >= ${this.param(value)}`;
      case "<=":
        return `${expression} <= ${this.param(value)}`;
      case "between":
      case "not_between": {
        const [low, high] = bounds(value);
        return `${expression} ${node.op === "between" ? "BETWEEN" : "NOT BETWEEN"} ${this.param(low)} AND ${this.param(high)}`;
      }
      case "empty":
        return `(${expression} IS NULL OR ${expression} = '')`;
      case "defined":
        return `(${expression} IS NOT NULL AND ${expression} != '')`;
      case "in_last":
        return `(${expression} IS NOT NULL AND ${expression} >= ${this.param(date_cutoff(this.now, value, clock))})`;
      case "not_in_last":
        return `(${expression} IS NULL OR ${expression} < ${this.param(date_cutoff(this.now, value, clock))})`;
      default:
        throw new Error(`operator ${node.op} is not valid on field ${node.field}`);
    }
  }

  ranked(name: string, node: LeafNode): string {
    const field = field_of(this.catalogue, name);
    if (!is_scalar_field(field)) throw new Error(`operator ${node.op} is not valid on field ${name}`);
    const value = this.scalar(name, "ranked");
    const direction = node.op === "top" ? "DESC" : "ASC";
    return `${this.id_of(row_alias)} IN (SELECT ${this.id_of("ranked")} FROM ${table_as(this.catalogue.table, "ranked")} WHERE ${value} IS NOT NULL ORDER BY ${value} ${direction}, ${this.id_of("ranked")} LIMIT ${this.param(Number(node.value))})`;
  }

  leaf(node: LeafNode, seen: readonly string[]): string {
    if (node.op === "in_filter") {
      const id = String(node.value);
      if (seen.includes(id)) throw new Error(`filter ${id} contains itself`);
      const target = this.resolve?.(id);
      if (!target) throw new Error(`no saved filter ${id}`);
      return this.node(target, [...seen, id]);
    }

    const operator = this.catalogue.operators?.[node.op];
    if (operator) return `(${operator.sql(node, this.context(row_alias))})`;

    const field = field_of(this.catalogue, node.field);
    if (field.kind === "custom") return `(${field.sql(node, this.context(row_alias))})`;
    if (field.kind === "set") return this.set_predicate(node.field, field, node);
    if (node.op === "top" || node.op === "bottom") return this.ranked(node.field, node);

    if (field.kind === "related") {
      const predicate = this.apply_op(column_of("related", field.column), node, field);
      return `EXISTS (SELECT 1 FROM ${table_as(field.table, "related")} WHERE ${column_of("related", field.foreign_key)} = ${this.id_of(row_alias)} AND ${predicate})`;
    }
    return this.apply_op(this.scalar(node.field, row_alias), node, field);
  }

  node(node: FilterNode, seen: readonly string[] = []): string {
    if (!is_group(node)) return this.leaf(node, seen);

    if (node.op === "not") {
      if (node.children.length !== 1) throw new Error("not takes exactly one child");
      // A condition on a missing value is false, not unknown, so its negation is true.
      return `NOT COALESCE((${this.node(node.children[0]!, seen)}), 0)`;
    }
    if (node.children.length === 0) return node.op === "and" ? "1" : "0";
    return `(${node.children.map((child) => this.node(child, seen)).join(node.op === "and" ? " AND " : " OR ")})`;
  }

  order_columns(alias: string, prefer: readonly OrderColumn[] | undefined): string {
    if (!prefer?.length) return "";
    return ` ORDER BY ${prefer.map((order) => `${column_of(alias, order.column)}${order.descending ? " DESC" : ""}`).join(", ")}`;
  }

  // The one value a row sorts and groups by.
  order_value(name: string): string {
    const field = field_of(this.catalogue, name);
    switch (field.kind) {
      case "column":
      case "expression":
        return this.scalar(name, row_alias);
      case "related":
        return `(SELECT ${column_of("preferred", field.column)} FROM ${table_as(field.table, "preferred")} WHERE ${column_of("preferred", field.foreign_key)} = ${this.id_of(row_alias)}${this.order_columns("preferred", field.prefer)} LIMIT 1)`;
      case "set": {
        const link_where = this.where_of("link", field.where);
        const order = field.order_column ? column_of("link", field.order_column) : null;
        if (field.values) {
          const value = column_of("value_row", field.values.value_column);
          return `(SELECT ${value} FROM ${table_as(field.table, "link")} JOIN ${table_as(field.values.table, "value_row")} ON ${column_of("value_row", field.values.id_column)} = ${column_of("link", field.value_column)} WHERE ${column_of("link", field.row_column)} = ${this.id_of(row_alias)}${link_where} ORDER BY ${order ?? value} LIMIT 1)`;
        }
        const value = column_of("link", field.value_column);
        return `(SELECT ${value} FROM ${table_as(field.table, "link")} WHERE ${column_of("link", field.row_column)} = ${this.id_of(row_alias)}${link_where} ORDER BY ${order ?? value} LIMIT 1)`;
      }
      case "custom":
        if (!field.order) throw new Error(`field ${name} cannot be sorted or grouped`);
        return `(${field.order(row_alias)})`;
    }
  }

  order_by(sort: readonly SortKey[] | undefined): string {
    if (!sort?.length) return "";
    const keys = sort.map((key) => {
      if (key.field === random_field && !this.catalogue.fields[random_field]) return "RANDOM()";
      const value = this.order_value(key.field);
      // Missing values go last whichever way the list runs.
      return `${value} IS NULL, ${value} ${key.descending ? "DESC" : "ASC"}`;
    });
    return ` ORDER BY ${keys.join(", ")}, ${this.id_of(row_alias)}`;
  }

  sums(sums: Readonly<Record<string, string>> | undefined): string {
    return Object.entries(sums ?? {})
      .map(([alias, name]) => `, SUM(COALESCE(${this.scalar(name, row_alias)}, 0)) AS ${quote_name(alias)}`)
      .join("");
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────

// The rows a filter picks, sorted, as SQL and its parameters.
export function compile_filter(catalogue: FilterCatalogue, node: FilterNode, options: FilterQueryOptions = {}): CompiledQuery {
  const compiler = new Compiler(catalogue, options.now ?? Date.now(), options.resolve);
  const select = options.select?.(row_alias) ?? compiler.id_of(row_alias);
  const where = compiler.node(node);
  let sql = `SELECT ${select} FROM ${table_as(catalogue.table, row_alias)} WHERE ${where}${compiler.order_by(options.sort)}`;

  if (options.limit !== undefined || options.offset !== undefined) sql += ` LIMIT ${compiler.param(options.limit ?? -1)}`;
  if (options.offset !== undefined) sql += ` OFFSET ${compiler.param(options.offset)}`;
  return { sql, params: compiler.params };
}

// How many of the rows a filter picks hold each value of a field, with sums, as panes of values show them.
export function compile_group_by(catalogue: FilterCatalogue, node: FilterNode, field_name: string, options: GroupQueryOptions = {}): CompiledQuery {
  const compiler = new Compiler(catalogue, options.now ?? Date.now(), options.resolve);
  const field = field_of(catalogue, field_name);
  const sums = compiler.sums(options.sums);
  const from = table_as(catalogue.table, row_alias);

  if (field.kind === "set") {
    const join_link = `JOIN ${table_as(field.table, "link")} ON ${column_of("link", field.row_column)} = ${compiler.id_of(row_alias)}${compiler.where_of("link", field.where)}`;
    const values = field.values;
    const group_id = values ? column_of("value_row", values.id_column) : column_of("link", field.value_column);
    const label = values ? column_of("value_row", values.value_column) : group_id;
    const join_values = values ? ` JOIN ${table_as(values.table, "value_row")} ON ${group_id} = ${column_of("link", field.value_column)}` : "";
    const order = values?.sort_column ? `COALESCE(${column_of("value_row", values.sort_column)}, ${label})` : label;
    const where = compiler.node(node);
    return {
      sql: `SELECT ${group_id} AS group_id, ${label} AS label, COUNT(*) AS "count"${sums} FROM ${from} ${join_link}${join_values} WHERE ${where} GROUP BY ${group_id} ORDER BY ${order}`,
      params: compiler.params,
    };
  }

  const value = compiler.order_value(field_name);
  const where = compiler.node(node);
  return {
    sql: `SELECT ${value} AS group_id, ${value} AS label, COUNT(*) AS "count"${sums} FROM ${from} WHERE ${where} GROUP BY ${value} ORDER BY ${value} IS NULL, ${value}`,
    params: compiler.params,
  };
}

// ── Running ──────────────────────────────────────────────────────────────────

export function query_rows<Row>(database: SqlDatabase, query: CompiledQuery): Row[] {
  return database.prepare(query.sql).all(...query.params) as Row[];
}

// The REGEXP function a `regex` condition calls, which the app registers on its connection: no match on a missing value or a bad pattern.
export function regexp_matches(pattern: unknown, value: unknown): number {
  if (value === null || value === undefined) return 0;
  try {
    return new RegExp(String(pattern), "u").test(String(value)) ? 1 : 0;
  } catch {
    return 0;
  }
}
