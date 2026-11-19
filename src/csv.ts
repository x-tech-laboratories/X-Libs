// CSV as RFC 4180 writes it, read and written: quoted fields may hold commas, quotes and line breaks. Also reads
// tab-separated text with no quoting, as LibraryThing exports it.

// ── Shapes ───────────────────────────────────────────────────────────────────

export type CsvValue = string | number | boolean | null | undefined;

// ── Reading ──────────────────────────────────────────────────────────────────

// Rows of cells; a leading byte-order mark and blank rows are dropped.
export function parse_csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function by_header([header, ...rows]: string[][]): Record<string, string>[] {
  if (!header) return [];
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), cells[index] ?? ""])));
}

// Each row after the header as an object by its column's name; a cell missing from a short row is "".
export function csv_records(text: string): Record<string, string>[] {
  return by_header(parse_csv(text));
}

// Tab-separated rows by column name: no quoting, so a quote is only a quote.
export function tsv_records(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n?|\n/)
    .filter((line) => line.trim() !== "");
  return by_header(lines.map((line) => line.split("\t")));
}

// ── Writing ──────────────────────────────────────────────────────────────────

// One cell, quoted only when it holds a comma, a quote or a line break; null and undefined are empty.
export function csv_field(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// A header and its rows, each line ended by CRLF.
export function write_csv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((row) => row.map(csv_field).join(",")).join("\r\n") + "\r\n";
}

// Records written under the columns given, in their order; a key not among them is left out.
export function write_csv_records(columns: string[], records: Record<string, CsvValue>[]): string {
  return write_csv(
    columns,
    records.map((record) => columns.map((column) => record[column])),
  );
}
