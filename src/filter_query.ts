// Search text as one filter: `artist:beatles rating:>3 year:1965..1970 -live played:<30d` read into the filter tree,
// each term kept with what it was read as, so a view can show it as a chip and take it away again. Text that is not
// a known field's condition is never an error; it is searched as words with the app's own text search.

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, leaf, not, or, type DateClock, type DateUnit, type FilterNode } from "./filter.ts";

// ── Fields ───────────────────────────────────────────────────────────────────

export type QueryFieldKind = "text" | "set" | "number" | "date";

export interface QueryField {
  // The field's name in the filter catalogue.
  field: string;
  kind: QueryFieldKind;
  // What the user may type before the colon, such as "artist" or "a"; matched without regard to case.
  names: readonly string[];
  // How a chip names the field, such as "Artist".
  label: string;
  // A number as typed into the stored value, such as stars into a rating or "4:00" into milliseconds; null when unreadable.
  parse_number?: (text: string) => number | null;
  // How a date field keeps its dates.
  clock?: DateClock;
  // The values a set field holds, so what was typed finds them whatever its case.
  values?: readonly string[];
}

export interface QueryOptions {
  fields: readonly QueryField[];
  // The filter for words searched as text, such as the app's full-text search.
  text: (words: string) => FilterNode;
}

// One term of the text: where it is, what filter it was read as, and how a chip names it.
export interface QueryTerm {
  start: number;
  end: number;
  source: string;
  node: FilterNode;
  label: string;
  // False when the term looked like a field's condition but was searched as words instead.
  understood: boolean;
}

export interface ParsedQuery {
  // Every term together; no terms match everything.
  node: FilterNode;
  terms: QueryTerm[];
}

// ── Splitting ────────────────────────────────────────────────────────────────

interface Piece {
  start: number;
  end: number;
  source: string;
}

// Splits at spaces, except inside double quotes or a /pattern/ that follows a colon or an equals sign.
function split_terms(text: string): Piece[] {
  const pieces: Piece[] = [];
  let start = -1;
  let closing: string | null = null;

  for (let index = 0; index <= text.length; index++) {
    const character = text[index];
    const at_end = index === text.length;

    if (closing !== null && !at_end) {
      if (character === closing) closing = null;
      continue;
    }
    if (at_end || /\s/.test(character!)) {
      if (start >= 0) pieces.push({ start, end: index, source: text.slice(start, index) });
      start = -1;
      continue;
    }
    if (start < 0) start = index;
    const before = text[index - 1];
    if (character === '"') closing = '"';
    else if (character === "/" && (before === ":" || before === "=")) closing = "/";
  }
  return pieces;
}

const unquote = (text: string): string => (text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text);

// ── Reading values ───────────────────────────────────────────────────────────

const relative_units: Readonly<Record<string, DateUnit>> = { h: "hour", d: "day", w: "week", m: "month", y: "year" };

const unit_words: Readonly<Record<DateUnit, string>> = { hour: "hour", day: "day", week: "week", month: "month", year: "year" };

// A local year, month or day such as 2024, 2024-03 or 2024-03-15, as the moments it starts and the next one starts.
function read_period(text: string, clock: DateClock): { from: number | string; until: number | string } | null {
  const parts = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = parts[2] === undefined ? null : Number(parts[2]) - 1;
  const day = parts[3] === undefined ? null : Number(parts[3]);
  if ((month !== null && (month < 0 || month > 11)) || (day !== null && (day < 1 || day > 31))) return null;

  const from = new Date(year, month ?? 0, day ?? 1);
  const until = day !== null ? new Date(year, month!, day + 1) : month !== null ? new Date(year, month + 1, 1) : new Date(year + 1, 0, 1);
  const kept = (moment: Date): number | string =>
    clock === "seconds" ? Math.floor(moment.getTime() / 1000) : clock === "iso" ? moment.toISOString() : moment.getTime();
  return { from: kept(from), until: kept(until) };
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

interface Reading {
  node: FilterNode;
  words: string;
}

const comparison = /^(>=|<=|>|<|=)?(.*)$/;

const comparison_words: Readonly<Record<string, string>> = { ">": "over", ">=": "at least", "<": "under", "<=": "at most", "=": "is" };

function read_number(field: QueryField, value: string): Reading | null {
  const parse = field.parse_number ?? ((text: string) => (text.trim() === "" || Number.isNaN(Number(text)) ? null : Number(text)));
  const range = /^(.+)\.\.(.+)$/.exec(value);
  if (range) {
    const low = parse(range[1]!);
    const high = parse(range[2]!);
    if (low === null || high === null) return null;
    return { node: leaf(field.field, "between", [low, high]), words: `${range[1]} to ${range[2]}` };
  }
  const [, sign = "=", rest = ""] = comparison.exec(value)!;
  const number = parse(rest);
  if (number === null) return null;
  return { node: leaf(field.field, sign === "=" ? "is" : sign, number), words: `${comparison_words[sign]} ${rest}` };
}

function read_date_condition(field: QueryField, value: string): Reading | null {
  const clock = field.clock ?? "milliseconds";
  const relative = /^([<>])(\d+)([hdwmy])$/.exec(value);
  if (relative) {
    const count = Number(relative[2]);
    const unit = relative_units[relative[3]!]!;
    const span = { count, unit };
    return relative[1] === "<"
      ? { node: leaf(field.field, "in_last", span), words: `in the last ${plural(count, unit_words[unit])}` }
      : { node: leaf(field.field, "not_in_last", span), words: `more than ${plural(count, unit_words[unit])} ago` };
  }

  const range = /^(.+)\.\.(.+)$/.exec(value);
  if (range) {
    const first = read_period(range[1]!, clock);
    const last = read_period(range[2]!, clock);
    if (first === null || last === null) return null;
    return { node: and(leaf(field.field, ">=", first.from), leaf(field.field, "<", last.until)), words: `from ${range[1]} to ${range[2]}` };
  }

  const [, sign = "=", rest = ""] = comparison.exec(value)!;
  const period = read_period(rest, clock);
  if (period === null) return null;
  switch (sign) {
    case ">":
      return { node: leaf(field.field, ">=", period.until), words: `after ${rest}` };
    case ">=":
      return { node: leaf(field.field, ">=", period.from), words: `in or after ${rest}` };
    case "<":
      return { node: leaf(field.field, "<", period.from), words: `before ${rest}` };
    case "<=":
      return { node: leaf(field.field, "<", period.until), words: `in or before ${rest}` };
    default:
      return { node: and(leaf(field.field, ">=", period.from), leaf(field.field, "<", period.until)), words: `in ${rest}` };
  }
}

// What was typed for a set field, as the values it holds: the same value whatever its case, or with "contains" every value holding the text.
function set_values(field: QueryField, typed: string, exact: boolean): string[] {
  if (!field.values) return [typed];
  const folded = typed.toLowerCase();
  const found = field.values.filter((value) => (exact ? value.toLowerCase() === folded : value.toLowerCase().includes(folded)));
  return found.length > 0 ? found : [typed];
}

const is_pattern = (value: string): boolean => value.length >= 2 && value.startsWith("/") && value.endsWith("/");

function read_text(field: QueryField, value: string, exact: boolean): Reading | null {
  if (value === "") return null;
  if (is_pattern(value)) {
    if (field.kind === "set") return null;
    const pattern = value.slice(1, -1);
    try {
      new RegExp(pattern);
    } catch {
      return null;
    }
    return { node: leaf(field.field, "regex", pattern), words: `matches ${value}` };
  }

  const quoted = value.startsWith('"');
  const choices = quoted ? [unquote(value)] : value.split(",").map((choice) => choice.trim()).filter((choice) => choice !== "");
  if (choices.length === 0) return null;
  const listed = choices.map((choice) => `"${choice}"`).join(" or ");

  if (field.kind === "set") {
    const values = [...new Set(choices.flatMap((choice) => set_values(field, choice, exact || quoted)))];
    return { node: leaf(field.field, "any", values), words: `${exact || quoted ? "is" : "has"} ${listed}` };
  }
  const op = exact ? "is" : "contains";
  const nodes = choices.map((choice) => leaf(field.field, op, choice));
  return { node: nodes.length === 1 ? nodes[0]! : or(...nodes), words: `${exact ? "is" : "contains"} ${listed}` };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const field_term = /^([A-Za-z_][\w-]*)(:|=)(.*)$/;

// Reads search text into a filter, one term at a time; each term may start with - to leave out what it matches.
export function parse_filter_query(text: string, options: QueryOptions): ParsedQuery {
  const by_name = new Map<string, QueryField>();
  for (const field of options.fields) for (const name of field.names) by_name.set(name.toLowerCase(), field);

  const terms: QueryTerm[] = [];
  for (const piece of split_terms(text)) {
    const negated = piece.source.length > 1 && piece.source.startsWith("-");
    const body = negated ? piece.source.slice(1) : piece.source;
    const parts = field_term.exec(body);
    const field = parts ? by_name.get(parts[1]!.toLowerCase()) : undefined;

    let reading: Reading | null = null;
    if (parts && field) {
      const value = parts[3]!;
      const exact = parts[2] === "=";
      if (field.kind === "number") reading = read_number(field, exact ? `=${value}` : value);
      else if (field.kind === "date") reading = read_date_condition(field, value);
      else reading = read_text(field, value, exact);
    }

    const understood = reading !== null;
    const words = understood ? reading!.words : `"${unquote(body)}"`;
    const node = understood ? reading!.node : options.text(unquote(body));
    terms.push({
      start: piece.start,
      end: piece.end,
      source: piece.source,
      node: negated ? not(node) : node,
      label: `${negated ? "not " : ""}${understood ? `${field!.label} ${words}` : words}`,
      understood: understood || !(parts && field)
    });
  }

  const nodes = terms.map((term) => term.node);
  return { node: nodes.length === 1 ? nodes[0]! : and(...nodes), terms };
}

// The text with one term taken out, for a chip's remove button.
export function without_term(text: string, term: Pick<QueryTerm, "start" | "end">): string {
  return `${text.slice(0, term.start)} ${text.slice(term.end)}`.replace(/\s+/g, " ").trim();
}
