// A small template language for text the user sets, such as labels, window titles and file names made from an item's
// fields: `{title}` a field, `{album_artist|artist}` the first that is not empty, `{track:%02d}` a field through a
// format, `[{disc}.]` a part left out when a field in it is empty, and a backslash before a character taken as it is.
// The values come from whatever the app hands in, and the app adds formats of its own beside the built-in ones.

// ── Imports ──────────────────────────────────────────────────────────────────

import { format_clock } from "./durations.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type FormatValue = string | number | null | undefined | readonly string[];
export type FormatSource = (field: string) => FormatValue;

// A format of the app's own, given the value and what was written in its brackets, such as `stars` or `pad(3)`.
export type FormatFunction = (value: FormatValue, argument: string | undefined) => string;

export interface FormatOptions {
  // Formats by name, used before the built-in ones of the same name.
  formats?: Readonly<Record<string, FormatFunction>>;
}

export type FormatToken =
  | { kind: "literal"; text: string }
  | { kind: "field"; fields: string[]; spec?: string }
  | { kind: "group"; children: FormatToken[] };

// ── Reading ──────────────────────────────────────────────────────────────────

// The template as tokens; an unclosed brace or bracket runs to the end of the text.
export function parse_format(template: string): FormatToken[] {
  let position = 0;

  function read_tokens(closing?: string): FormatToken[] {
    const tokens: FormatToken[] = [];
    let literal = "";
    const flush = (): void => {
      if (literal) tokens.push({ kind: "literal", text: literal });
      literal = "";
    };

    while (position < template.length) {
      const character = template[position]!;

      if (closing && character === closing) {
        position++;
        break;
      }
      if (character === "\\" && position + 1 < template.length) {
        literal += template[position + 1];
        position += 2;
        continue;
      }
      if (character === "[") {
        position++;
        flush();
        tokens.push({ kind: "group", children: read_tokens("]") });
        continue;
      }
      if (character === "{") {
        const end = template.indexOf("}", position + 1);
        const body = template.slice(position + 1, end === -1 ? undefined : end);
        position = end === -1 ? template.length : end + 1;
        flush();
        const colon = body.indexOf(":");
        const names = colon === -1 ? body : body.slice(0, colon);
        const fields = names.split("|").map((name) => name.trim());
        tokens.push(colon === -1 ? { kind: "field", fields } : { kind: "field", fields, spec: body.slice(colon + 1) });
        continue;
      }
      literal += character;
      position++;
    }

    flush();
    return tokens;
  }

  return read_tokens();
}

// Every field a template names, so the app knows what to fetch.
export function template_fields(template: string): string[] {
  const fields = new Set<string>();
  const walk = (tokens: readonly FormatToken[]): void => {
    for (const token of tokens) {
      if (token.kind === "field") token.fields.forEach((field) => fields.add(field));
      else if (token.kind === "group") walk(token.children);
    }
  };
  walk(parse_format(template));
  return [...fields];
}

// ── Formats ──────────────────────────────────────────────────────────────────

export const is_empty_value = (value: FormatValue): boolean => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

const unquote = (text: string): string => text.trim().replace(/^(["'])(.*)\1$/, "$2");

function split_spec(spec: string): { name: string; argument: string | undefined } {
  const call = /^([\w-]+)\((.*)\)$/s.exec(spec);
  return call ? { name: call[1]!, argument: unquote(call[2]!) } : { name: spec, argument: undefined };
}

function built_in(value: FormatValue, name: string, argument: string | undefined, spec: string): string {
  if (Array.isArray(value)) {
    if (name === "join") return value.join(argument ?? ", ");
    if (name === "count") return String(value.length);
    if (name === "first") return value[0] ?? "";
    return value.join(", ");
  }

  const number = typeof value === "number" ? value : Number(value);
  if (spec === "m:ss") return format_clock(number);
  if (spec === "h:mm:ss") return format_clock(number, { hours: "always" });

  const padding = /^%0?(\d+)d$/.exec(spec);
  if (padding && Number.isFinite(number)) return String(Math.trunc(number)).padStart(Number(padding[1]), "0");

  const text = String(value);
  const base = text.split("/").pop() ?? text;
  switch (name) {
    case "basename":
      return base;
    case "dirname":
      return text.slice(0, Math.max(0, text.lastIndexOf("/"))) || "/";
    case "ext":
      return base.lastIndexOf(".") > 0 ? base.slice(base.lastIndexOf(".") + 1) : "";
    case "upper":
      return text.toLocaleUpperCase();
    case "lower":
      return text.toLocaleLowerCase();
    case "title":
      return text.replace(/\p{L}[\p{L}\p{M}']*/gu, (word) => word[0]!.toLocaleUpperCase() + word.slice(1).toLocaleLowerCase());
    default:
      return text;
  }
}

// One value through a format, the app's own first; an empty value stays empty.
export function apply_format(value: FormatValue, spec: string | undefined, options: FormatOptions = {}): string {
  if (is_empty_value(value)) return "";
  if (spec === undefined) return Array.isArray(value) ? value.join(", ") : String(value);

  const { name, argument } = split_spec(spec);
  const own = options.formats?.[spec] ?? options.formats?.[name];
  if (own) return own(value, options.formats?.[spec] ? undefined : argument);
  return built_in(value, name, argument, spec);
}

// ── Writing ──────────────────────────────────────────────────────────────────

function render(tokens: readonly FormatToken[], source: FormatSource, options: FormatOptions): { text: string; missing: boolean } {
  let text = "";
  let missing = false;

  for (const token of tokens) {
    if (token.kind === "literal") {
      text += token.text;
    } else if (token.kind === "group") {
      const inner = render(token.children, source, options);
      if (!inner.missing) text += inner.text;
    } else {
      const found = token.fields.map(source).find((value) => !is_empty_value(value));
      if (found === undefined) missing = true;
      else text += apply_format(found, token.spec, options);
    }
  }

  return { text, missing };
}

// The template read once, to fill in for many items.
export function compile_format(template: string, options: FormatOptions = {}): (source: FormatSource) => string {
  const tokens = parse_format(template);
  return (source) => render(tokens, source, options).text;
}

export function format_string(template: string, source: FormatSource, options: FormatOptions = {}): string {
  return compile_format(template, options)(source);
}

// The template filled from a plain object's fields.
export function format_record(template: string, record: Readonly<Record<string, FormatValue>>, options: FormatOptions = {}): string {
  return format_string(template, (field) => record[field], options);
}
