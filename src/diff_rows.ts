// A change to text files laid out for reading. A unified diff, as git diff prints it, is read into files, hunks and
// numbered lines through parse-diff; each file is laid out side by side, old on the left and new on the right, or as
// one column; removed and added lines are paired so the words that changed within them are marked, through jsdiff; and
// long unchanged stretches fold down to a few lines on each side of a change. `edit_lines` diffs a before and after
// text, such as one edit an agent made. parse-diff (MIT) and jsdiff (BSD-3-Clause) were chosen because they read git's
// format and mark words exactly as the hand-written readers did, and work alike in a page, a phone and Node.

// ── Imports ──────────────────────────────────────────────────────────────────

import { diffLines, diffWordsWithSpace } from "diff";
import parse_diff from "parse-diff";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type DiffLineKind = "added" | "removed" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  // The line's number before and after the change; null on the side it is missing from.
  old_number: number | null;
  new_number: number | null;
}

export interface DiffHunk {
  // The @@ line, with the function or heading git found around it.
  header: string;
  lines: DiffLine[];
}

export type DiffFileStatus = "added" | "removed" | "renamed" | "changed";

export interface DiffFile {
  path: string;
  // The path before a rename; the same as path otherwise.
  old_path: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  // Empty for a binary file, a bare rename or a change of mode, which have no lines to show.
  hunks: DiffHunk[];
}

// A piece of a line, marked when it is what changed.
export interface WordPart {
  text: string;
  changed: boolean;
}

export interface DiffCell {
  number: number;
  parts: WordPart[];
}

// One row of the side-by-side layout: an unchanged line on both sides, or a change with either side possibly empty.
export type SplitRow = { kind: "same"; left: DiffCell; right: DiffCell } | { kind: "change"; left: DiffCell | null; right: DiffCell | null } | { kind: "hunk"; header: string };

// One row of the single-column layout.
export type UnifiedRow = { kind: "same" | "removed" | "added"; old_number: number | null; new_number: number | null; parts: WordPart[] } | { kind: "hunk"; header: string };

// A stretch of unchanged rows shown as one "show more" row until opened.
export interface DiffFold {
  kind: "fold";
  // Where the stretch starts in the rows, which names it.
  start: number;
  count: number;
}

// One line of a before-and-after diff.
export interface EditLine {
  kind: DiffLineKind;
  text: string;
}

// Lines kept on each side of a change when the rest of an unchanged stretch folds.
export const context_lines = 3;

// ── Reading ──────────────────────────────────────────────────────────────────

const no_file = "/dev/null";

function status_of(file: parse_diff.File, path: string, old_path: string): DiffFileStatus {
  if (file.new || file.from === no_file) return "added";
  if (file.deleted || file.to === no_file) return "removed";
  return path === old_path ? "changed" : "renamed";
}

function line_of(change: parse_diff.Change): DiffLine {
  // parse-diff keeps the leading +, - or space, which the view draws apart.
  const text = change.content.slice(1);
  if (change.type === "add") return { kind: "added", text, old_number: null, new_number: change.ln };
  if (change.type === "del") return { kind: "removed", text, old_number: change.ln, new_number: null };
  return { kind: "context", text, old_number: change.ln1, new_number: change.ln2 };
}

// The files a unified diff changes, in the order it lists them.
export function parse_unified_diff(text: string): DiffFile[] {
  return parse_diff(text).map((file) => {
    const path = file.to && file.to !== no_file ? file.to : (file.from ?? "");
    const old_path = file.from && file.from !== no_file ? file.from : path;
    const hunks = file.chunks.map((chunk) => ({ header: chunk.content, lines: chunk.changes.filter((change) => !change.content.startsWith("\\")).map(line_of) }));
    return { path, old_path, status: status_of(file, path, old_path), additions: file.additions, deletions: file.deletions, hunks };
  });
}

// The whole change's added and removed line counts.
export function diff_totals(files: Pick<DiffFile, "additions" | "deletions">[]): { additions: number; deletions: number } {
  return files.reduce((total, file) => ({ additions: total.additions + file.additions, deletions: total.deletions + file.deletions }), { additions: 0, deletions: 0 });
}

// A diff cut at the last whole file within a size, and whether it was cut.
export function diff_within_limit(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const cut = text.lastIndexOf("\ndiff --git ", limit);
  return { text: cut > 0 ? text.slice(0, cut + 1) : "", truncated: true };
}

// ── Words ────────────────────────────────────────────────────────────────────

const whole = (text: string): WordPart[] => [{ text, changed: false }];

// The words of an old and a new line, each side marking what it lost or gained; a line changed through is left whole.
export function word_parts(old_text: string, new_text: string): { old: WordPart[]; new: WordPart[] } {
  const parts = diffWordsWithSpace(old_text, new_text);
  const kept = parts.filter((part) => !part.added && !part.removed).reduce((total, part) => total + part.value.trim().length, 0);
  if (kept === 0) return { old: whole(old_text), new: whole(new_text) };
  return {
    old: parts.filter((part) => !part.added).map((part) => ({ text: part.value, changed: Boolean(part.removed) })),
    new: parts.filter((part) => !part.removed).map((part) => ({ text: part.value, changed: Boolean(part.added) })),
  };
}

// ── Pairing ──────────────────────────────────────────────────────────────────

interface Block {
  removed: DiffLine[];
  added: DiffLine[];
}

// Each hunk's lines walked as unchanged lines and blocks of removed lines followed by added ones.
function walk(file: DiffFile, on_header: (header: string) => void, on_same: (line: DiffLine) => void, on_block: (block: Block) => void): void {
  for (const hunk of file.hunks) {
    if (file.hunks.length > 1) on_header(hunk.header);
    let block: Block = { removed: [], added: [] };
    const flush = () => {
      if (block.removed.length || block.added.length) on_block(block);
      block = { removed: [], added: [] };
    };
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        flush();
        on_same(line);
      } else if (line.kind === "removed") {
        if (block.added.length) flush();
        block.removed.push(line);
      } else block.added.push(line);
    }
    flush();
  }
}

// The paired lines' words, a removed line matched with the added line at the same place in its block.
function paired(block: Block): { old: WordPart[][]; new: WordPart[][] } {
  const old = block.removed.map((line) => whole(line.text));
  const fresh = block.added.map((line) => whole(line.text));
  for (let index = 0; index < Math.min(old.length, fresh.length); index += 1) {
    const words = word_parts(block.removed[index]!.text, block.added[index]!.text);
    old[index] = words.old;
    fresh[index] = words.new;
  }
  return { old, new: fresh };
}

// The file as rows of old and new side by side.
export function split_rows(file: DiffFile): SplitRow[] {
  const rows: SplitRow[] = [];
  walk(
    file,
    (header) => rows.push({ kind: "hunk", header }),
    (line) => rows.push({ kind: "same", left: { number: line.old_number!, parts: whole(line.text) }, right: { number: line.new_number!, parts: whole(line.text) } }),
    (block) => {
      const words = paired(block);
      for (let index = 0; index < Math.max(block.removed.length, block.added.length); index += 1) {
        const old_line = block.removed[index];
        const new_line = block.added[index];
        rows.push({ kind: "change", left: old_line ? { number: old_line.old_number!, parts: words.old[index]! } : null, right: new_line ? { number: new_line.new_number!, parts: words.new[index]! } : null });
      }
    },
  );
  return rows;
}

// The file as one column, each block's removed lines before its added ones.
export function unified_rows(file: DiffFile): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  walk(
    file,
    (header) => rows.push({ kind: "hunk", header }),
    (line) => rows.push({ kind: "same", old_number: line.old_number, new_number: line.new_number, parts: whole(line.text) }),
    (block) => {
      const words = paired(block);
      block.removed.forEach((line, index) => rows.push({ kind: "removed", old_number: line.old_number, new_number: null, parts: words.old[index]! }));
      block.added.forEach((line, index) => rows.push({ kind: "added", old_number: null, new_number: line.new_number, parts: words.new[index]! }));
    },
  );
  return rows;
}

// ── Folding ──────────────────────────────────────────────────────────────────

// The rows with each long unchanged stretch cut to a few lines beside its changes, the rest a fold, unless opened.
export function fold_rows<Row extends { kind: string }>(rows: Row[], opened: ReadonlySet<number>, context = context_lines): (Row | DiffFold)[] {
  const shown: (Row | DiffFold)[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index]!.kind !== "same") {
      shown.push(rows[index]!);
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end]!.kind === "same") end += 1;
    const keep_before = index === 0 ? 0 : context;
    const keep_after = end === rows.length ? 0 : context;
    const hidden = end - index - keep_before - keep_after;
    if (hidden > 1 && !opened.has(index)) {
      shown.push(...rows.slice(index, index + keep_before), { kind: "fold", start: index, count: hidden }, ...rows.slice(end - keep_after, end));
    } else {
      shown.push(...rows.slice(index, end));
    }
    index = end;
  }
  return shown;
}

// ── Before and after ─────────────────────────────────────────────────────────

// A before and after text as lines marked added, removed or kept.
export function edit_lines(before: string, after: string): EditLine[] {
  return diffLines(before, after).flatMap((part) => {
    const kind: DiffLineKind = part.added ? "added" : part.removed ? "removed" : "context";
    return part.value.replace(/\n$/, "").split("\n").map((text) => ({ kind, text }));
  });
}
