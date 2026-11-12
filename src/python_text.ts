// Text as Python writes and reads it, for apps ported from Python whose logs, settings, shell commands and pages must
// stay byte-for-byte the same: str(), repr(), json.dumps(), str.format() with its format specs, the numbers its
// format specs write (fixed decimals rounding an exact tie to even, thousands grouped), str.splitlines(), str.split(),
// str.partition(), int() and float() of text, fnmatch globs and named groups in regular expressions.

// ── Numbers ──────────────────────────────────────────────────────────────────

// A number with fixed decimals as Python's "{:.Nf}" writes it, rounding an exact tie to even where toFixed rounds up.
export function format_fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "inf" : value < 0 ? "-inf" : "nan";
  const exact = Math.abs(value).toFixed(Math.min(100, digits + 40));
  const point = exact.indexOf(".");
  const tail = exact.slice(point + 1 + digits);
  if (!/^50*$/.test(tail)) return value.toFixed(digits);
  const kept = exact.slice(0, point + 1 + digits).replace(/\.$/, "");
  const last_digit = Number(kept.replace(".", "").slice(-1));
  if (last_digit % 2 === 0) return (value < 0 ? "-" : "") + kept;
  return value.toFixed(digits);
}

// A number as Python's "{:,.Nf}" writes it: fixed decimals with commas between thousands.
export function format_grouped(value: number, digits: number): string {
  const text = format_fixed(value, digits);
  const [whole, fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

// A number rounded as Python's round(value, digits) does, an exact tie going to even.
export function round_half_even(value: number, digits = 0): number {
  return Number(format_fixed(value, digits));
}

// A float as Python's str() and repr() write it: the shortest round-trip digits, "42.0" for a whole number, and an
// exponent such as "1e-05" below 1e-4 or from 1e16.
export function python_float_repr(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const [mantissa, exponent_text] = value.toExponential().split("e");
  const exponent = Number(exponent_text);
  const negative = mantissa.startsWith("-");
  const digits = mantissa.replace("-", "").replace(".", "");
  const sign = negative ? "-" : "";
  if (exponent < -4 || exponent >= 16) {
    const body = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${body}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
  const fraction = digits.slice(exponent + 1);
  return `${sign}${whole}.${fraction || "0"}`;
}

// ── Splitting ────────────────────────────────────────────────────────────────

// Lines as Python's str.splitlines() gives them: no line endings, and no empty last line after a final newline.
export function split_lines(text: string): string[] {
  if (text === "") return [];
  // oxlint-disable-next-line no-control-regex
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// Words as Python's str.split() with no separator gives them; with `max_split`, the rest stays whole in the last word.
export function split_words(text: string, max_split = -1): string[] {
  if (max_split < 0) return text.split(/\s+/).filter((word) => word !== "");
  const words: string[] = [];
  let rest = text.replace(/^\s+/, "");
  while (rest !== "" && words.length < max_split) {
    const match = /\s+/.exec(rest);
    if (match === null) break;
    words.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest !== "") words.push(words.length < max_split ? rest.replace(/\s+$/, "") : rest);
  return words;
}

// Python's str.partition: the text before the first separator, the separator, and the rest.
export function partition(text: string, separator: string): [before: string, found: string, after: string] {
  const index = text.indexOf(separator);
  if (index === -1) return [text, "", ""];
  return [text.slice(0, index), separator, text.slice(index + separator.length)];
}

// ── Numbers ──────────────────────────────────────────────────────────────────

// A whole number as Python's int() reads text, throwing on anything else.
export function parse_int(text: unknown): number {
  if (typeof text === "number") {
    if (!Number.isFinite(text)) throw new Error(`cannot convert float ${text} to integer`);
    return Math.trunc(text);
  }
  const value = String(text);
  if (!/^\s*[+-]?\d+(_\d+)*\s*$/.test(value)) throw new Error(`invalid literal for int() with base 10: '${value}'`);
  return Number(value.trim().replaceAll("_", ""));
}

// A number as Python's float() reads text, throwing on anything else.
export function parse_float(text: unknown): number {
  if (typeof text === "number") return text;
  const value = String(text);
  const trimmed = value.trim();
  if (/^[+-]?(inf|infinity)$/i.test(trimmed)) return trimmed.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(trimmed)) return Number.NaN;
  if (!/^[+-]?(\d+(_\d+)*(\.(\d+(_\d+)*)?)?|\.\d+(_\d+)*)([eE][+-]?\d+)?$/.test(trimmed)) {
    throw new Error(`could not convert string to float: '${value}'`);
  }
  return Number(trimmed.replaceAll("_", ""));
}

// Python's int(), or null where it would raise.
export function int_or_null(text: unknown): number | null {
  try {
    return parse_int(text);
  } catch {
    return null;
  }
}

// Python's float(), or null where it would raise.
export function float_or_null(text: unknown): number | null {
  try {
    return parse_float(text);
  } catch {
    return null;
  }
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// Whether a name matches a shell-style pattern as Python's fnmatch.fnmatch does on POSIX: *, ?, [seq] and [!seq],
// case-sensitive, the whole name.
export function fnmatch(name: string, pattern: string): boolean {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const character = pattern[index++];
    if (character === "*") source += "[\\s\\S]*";
    else if (character === "?") source += "[\\s\\S]";
    else if (character === "[") {
      let end = index;
      if (end < pattern.length && pattern[end] === "!") end++;
      if (end < pattern.length && pattern[end] === "]") end++;
      while (end < pattern.length && pattern[end] !== "]") end++;
      if (end >= pattern.length) {
        source += "\\[";
      } else {
        let set = pattern.slice(index, end).replaceAll("\\", "\\\\");
        index = end + 1;
        if (set.startsWith("!")) set = `^${set.slice(1)}`;
        else if (set.startsWith("^")) set = `\\${set}`;
        source += `[${set}]`;
      }
    } else source += character.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^(?:${source})$`).test(name);
}

// A Python regular expression as a JavaScript one: named groups (?P<name>...) and backreferences (?P=name) rewritten.
export function python_regex(pattern: string, flags = ""): RegExp {
  return new RegExp(pattern.replace(/\(\?P<([A-Za-z_]\w*)>/g, "(?<$1>").replace(/\(\?P=([A-Za-z_]\w*)\)/g, "\\k<$1>"), flags);
}

// ── repr ─────────────────────────────────────────────────────────────────────

// A string as Python's repr() writes it: single quotes unless the text holds one and no double quote.
function string_repr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let body = "";
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (character === "\\") body += "\\\\";
    else if (character === quote) body += `\\${quote}`;
    else if (character === "\n") body += "\\n";
    else if (character === "\r") body += "\\r";
    else if (character === "\t") body += "\\t";
    else if (code < 0x20 || code === 0x7f) body += `\\x${code.toString(16).padStart(2, "0")}`;
    else body += character;
  }
  return quote + body + quote;
}

// Any value as Python's repr() writes it; numbers print as JavaScript does, so a whole float loses its ".0".
export function python_repr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return string_repr(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(python_repr).join(", ")}]`;
  if (value instanceof Set) return value.size === 0 ? "set()" : `{${[...value].map(python_repr).join(", ")}}`;
  if (value instanceof Date) return `datetime(${value.toISOString()})`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).map(([key, item]) => `${string_repr(key)}: ${python_repr(item)}`).join(", ")}}`;
  }
  return String(value);
}

// ── json.dumps ───────────────────────────────────────────────────────────────

function ascii_string(text: string): string {
  return JSON.stringify(text).replace(/[\u007f-￿]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// JSON as Python's json.dumps writes it: ", " and ": " separators, non-ASCII escaped, keys in insertion order unless
// `sort_keys`, so settings the Python app stored compare equal.
export function python_dumps(value: unknown, sort_keys = false): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return ascii_string(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return ascii_string(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => python_dumps(item, sort_keys)).join(", ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined);
    if (sort_keys) keys.sort();
    return `{${keys.map((key) => `${ascii_string(key)}: ${python_dumps((value as Record<string, unknown>)[key], sort_keys)}`).join(", ")}}`;
  }
  return ascii_string(String(value));
}

// ── str() ────────────────────────────────────────────────────────────────────

// A value as Python's str() writes it: None, True and False by name, lists and dicts as JSON.
export function python_str(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ── format() ─────────────────────────────────────────────────────────────────

// Looks one field up: a positional index, a keyword, then `.attr` and `[key]` steps.
export type FieldLookup = (name: string) => unknown;

function step_into(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "function") return (value as (key: string) => unknown)(key);
  const found = (value as Record<string, unknown>)[key];
  return found;
}

function resolve_field(field: string, lookup: FieldLookup): unknown {
  const match = /^([^.[]*)(.*)$/.exec(field)!;
  let value = lookup(match[1]);
  const steps = match[2].matchAll(/\.([^.[]+)|\[([^\]]*)\]/g);
  for (const step of steps) value = step_into(value, step[1] ?? step[2]);
  return value;
}

function group_thousands(text: string): string {
  const [whole, fraction] = text.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = whole.replace(/^-/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + digits + (fraction !== undefined ? `.${fraction}` : "");
}

// Applies a format spec such as ".1f", ",", ">8" or "d" to one value.
export function apply_format_spec(value: unknown, spec: string): string {
  const match = /^(?:(.)?([<>^]))?(0)?(\d+)?(,)?(?:\.(\d+))?([sdfFeg%])?$/.exec(spec);
  if (spec === "" || match === null) return python_str(value);
  const [, fill = " ", align, zero, width, comma, precision, kind] = match;
  let text: string;
  if (typeof value === "number" && kind !== "s") {
    if (kind === "f" || kind === "F") text = format_fixed(value, Number(precision ?? 6));
    else if (kind === "%") text = `${format_fixed(value * 100, Number(precision ?? 6))}%`;
    else if (kind === "d") text = String(Math.trunc(value));
    else if (kind === "e") text = value.toExponential(Number(precision ?? 6)).replace(/e([+-])(\d)$/, "e$10$2");
    else if (precision !== undefined) text = format_fixed(value, Number(precision));
    else text = String(value);
    if (comma) text = group_thousands(text);
  } else {
    text = python_str(value);
    if (precision !== undefined) text = text.slice(0, Number(precision));
  }
  const size = Number(width ?? 0);
  if (text.length >= size) return text;
  const padding = (zero ? "0" : fill).repeat(size - text.length);
  const side = align ?? (typeof value === "number" ? ">" : "<");
  if (side === "<") return text + padding;
  if (side === "^") return padding.slice(0, Math.floor(padding.length / 2)) + text + padding.slice(Math.floor(padding.length / 2));
  return padding + text;
}

// Fills a Python str.format template: "{}" and "{0}" take positional arguments, "{name}" keywords, with ".attr" and
// "[key]" steps and a ":spec"; "{{" and "}}" are literal braces.
export function python_format(template: string, positional: readonly unknown[] = [], keywords: Record<string, unknown> = {}): string {
  let auto_index = 0;
  const lookup: FieldLookup = (name) => {
    if (name === "") return positional[auto_index++];
    if (/^\d+$/.test(name)) return positional[Number(name)];
    return keywords[name];
  };
  return template.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (whole, inner: string | undefined) => {
    if (whole === "{{") return "{";
    if (whole === "}}") return "}";
    const body = inner ?? "";
    const colon = body.indexOf(":");
    const field = colon === -1 ? body : body.slice(0, colon);
    const spec = colon === -1 ? "" : body.slice(colon + 1);
    const conversion = /!([rs])$/.exec(field);
    const value = resolve_field(conversion ? field.slice(0, -2) : field, lookup);
    if (conversion?.[1] === "r") return python_repr(value);
    return apply_format_spec(value, spec);
  });
}
