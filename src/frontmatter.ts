// Markdown files that start with YAML frontmatter between --- lines, such as agent definitions or notes: read into the
// frontmatter document and the body, the values read as text or lists whatever shape they were written in, and written
// back with the app's keys set or dropped while every other key and comment stays as it was. It runs alike in a page
// and in Node, on the `yaml` package, an optional peer the app installs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Document, parseDocument } from "yaml";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface FrontmatterFile {
  // The frontmatter as a YAML document, which keeps comments and the order of keys when written again.
  frontmatter: Document;
  // The text after the frontmatter, trimmed.
  body: string;
}

const frontmatter_pattern = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

// ── Reading ──────────────────────────────────────────────────────────────────

// The file's frontmatter and body; throws in plain words when it has no frontmatter or it is not a set of keys.
export function parse_frontmatter(text: string): FrontmatterFile {
  const match = frontmatter_pattern.exec(text);
  if (!match) throw new Error("it does not start with a frontmatter block between --- lines");
  const frontmatter = parseDocument(match[1] ?? "");
  if (frontmatter.errors.length) throw new Error(`its frontmatter is not valid YAML: ${frontmatter.errors[0]!.message}`);
  const values = frontmatter.toJS() as unknown;
  if (frontmatter.contents !== null && (typeof values !== "object" || values === null || Array.isArray(values))) throw new Error("its frontmatter is not a set of keys");
  return { frontmatter, body: match[2]!.trim() };
}

// The frontmatter's keys and values, an empty frontmatter as none.
export function frontmatter_values(file: FrontmatterFile): Record<string, unknown> {
  return (file.frontmatter.toJS() ?? {}) as Record<string, unknown>;
}

// A value as text: a string, or a number written out; anything else as "".
export function frontmatter_text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

// A value as a list of text, from a YAML list or a comma-separated line such as "Read, Grep, Bash".
export function frontmatter_list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(frontmatter_text).filter(Boolean);
  return frontmatter_text(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// ── Writing ──────────────────────────────────────────────────────────────────

// Whether a value is left out of the frontmatter: undefined, null, "" or an empty list.
function is_empty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

// The file's text with the values given set, or dropped when empty, every other key and comment kept from `previous`.
export function write_frontmatter(values: Record<string, unknown>, body: string, previous: Document | null = null): string {
  const document = previous ? previous.clone() : new Document({});
  if (document.contents === null) document.contents = document.createNode({}) as Document["contents"];
  for (const [key, value] of Object.entries(values)) {
    if (is_empty(value)) document.delete(key);
    else document.set(key, value);
  }
  const trimmed = body.trim();
  return `---\n${String(document).trimEnd()}\n---\n${trimmed ? `\n${trimmed}\n` : ""}`;
}
