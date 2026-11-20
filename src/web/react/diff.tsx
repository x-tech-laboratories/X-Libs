// One file's change drawn from `diff_rows`: side by side with the old lines on the left and the new on the right, or
// in one column, each line numbered, removed and added lines tinted and the words that changed within them tinted again
// through Halon's diff classes, and long unchanged stretches folded behind a "show more" row; a file's text read-only
// with numbered lines; a small diff of one edit's before and after; and the added and removed line counts.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Fragment, useState } from "react";

import { edit_lines, fold_rows, split_rows, unified_rows, type DiffCell, type DiffFile, type DiffFileStatus, type DiffFold, type DiffLineKind, type WordPart } from "../../diff_rows.ts";
import { cx } from "../dom.ts";
import type { Tone } from "./badges.tsx";

// ── Words ────────────────────────────────────────────────────────────────────

// Each status's label, its one-letter mark and its badge tone.
export const diff_status_words: Record<DiffFileStatus, [label: string, letter: string, tone: Tone]> = {
  added: ["Added", "A", "good"],
  removed: ["Deleted", "D", "bad"],
  renamed: ["Renamed", "R", "info"],
  changed: ["Modified", "M", "warn"],
};

export type DiffLayout = "split" | "unified";

type Side = "removed" | "added";

// ── Pieces ───────────────────────────────────────────────────────────────────

// A change's added and removed line counts, such as "+3 −1".
export function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diff-counts" aria-label={`${additions} added, ${deletions} removed`}>
      <span className="diff-count-added">+{additions}</span> <span className="diff-count-removed">−{deletions}</span>
    </span>
  );
}

// A line's text with its changed words marked, inside a removed or added line.
function Words({ parts, side }: { parts: WordPart[]; side: Side | null }) {
  return (
    <code>
      {parts.map((part, index) =>
        part.changed && side ? (
          <mark key={index} className="diff-word">
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </code>
  );
}

function FoldRow({ fold, columns, on_open }: { fold: DiffFold; columns: number; on_open: (start: number) => void }) {
  return (
    <tr className="diff-fold">
      <td colSpan={columns}>
        <button type="button" className="link" onClick={() => on_open(fold.start)}>
          Show {fold.count} more unchanged lines
        </button>
      </td>
    </tr>
  );
}

function HunkRow({ header, columns }: { header: string; columns: number }) {
  return (
    <tr className="diff-hunk">
      <td colSpan={columns}>
        <code>{header}</code>
      </td>
    </tr>
  );
}

function SideCells({ cell, side }: { cell: DiffCell | null; side: Side | null }) {
  if (!cell) {
    return (
      <>
        <td className="diff-number diff-empty" />
        <td className="diff-text diff-empty" />
      </>
    );
  }
  const tint = side && `diff-${side}`;
  return (
    <>
      <td className={cx("diff-number", tint)}>{cell.number}</td>
      <td className={cx("diff-text", tint)} aria-label={side ?? undefined}>
        <Words parts={cell.parts} side={side} />
      </td>
    </>
  );
}

// ── File ─────────────────────────────────────────────────────────────────────

interface FileDiffProps {
  file: DiffFile;
  layout: DiffLayout;
  // Said when the file has no lines, such as a binary file, a bare rename or a change of mode.
  no_lines_text?: string;
}

export function FileDiff({ file, layout, no_lines_text = "No lines to show: a binary file, a bare rename or a change of mode." }: FileDiffProps) {
  const [opened, set_opened] = useState<ReadonlySet<number>>(new Set());
  const open = (start: number) => set_opened((current) => new Set([...current, start]));
  if (file.hunks.length === 0) return <p className="diff-note">{no_lines_text}</p>;

  if (layout === "unified") {
    const rows = fold_rows(unified_rows(file), opened);
    return (
      <div className="diff-scroll">
        <table className="diff-lines diff-unified" aria-label={`Changes to ${file.path}`}>
          <tbody>
            {rows.map((row, index) => {
              if (row.kind === "fold") return <FoldRow key={`fold-${row.start}`} fold={row} columns={4} on_open={open} />;
              if (row.kind === "hunk") return <HunkRow key={index} header={row.header} columns={4} />;
              const side = row.kind === "same" ? null : row.kind;
              return (
                <tr key={index} className={side ? `diff-${side}` : undefined}>
                  <td className="diff-number">{row.old_number ?? ""}</td>
                  <td className="diff-number">{row.new_number ?? ""}</td>
                  <td className="diff-mark" aria-label={side ?? undefined}>
                    {side === "added" ? "+" : side === "removed" ? "−" : " "}
                  </td>
                  <td className="diff-text">
                    <Words parts={row.parts} side={side} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const rows = fold_rows(split_rows(file), opened);
  return (
    <div className="diff-scroll">
      <table className="diff-lines diff-split" aria-label={`Changes to ${file.path}, old on the left and new on the right`}>
        <colgroup>
          <col className="diff-number-column" />
          <col />
          <col className="diff-number-column" />
          <col />
        </colgroup>
        <tbody>
          {rows.map((row, index) => {
            if (row.kind === "fold") return <FoldRow key={`fold-${row.start}`} fold={row} columns={4} on_open={open} />;
            if (row.kind === "hunk") return <HunkRow key={index} header={row.header} columns={4} />;
            const changed = row.kind === "change";
            return (
              <tr key={index}>
                <SideCells cell={row.left} side={changed ? "removed" : null} />
                <SideCells cell={row.right} side={changed ? "added" : null} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Plain file ───────────────────────────────────────────────────────────────

// A file's text read-only, each line numbered, with no diff columns.
export function FileContent({ path, text }: { path: string; text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <div className="diff-scroll">
      <table className="diff-lines diff-plain" aria-label={`Contents of ${path}`}>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td className="diff-number">{index + 1}</td>
              <td className="diff-text">
                <code>{line}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── One edit ─────────────────────────────────────────────────────────────────

const edit_marks: Record<DiffLineKind, string> = { added: "+", removed: "−", context: " " };

interface EditDiffProps {
  // The file the edit is to, shown above it when given.
  path?: string;
  // The text before and after; empty before for a new file.
  before: string;
  after: string;
  // The most lines shown before the rest is left out.
  limit?: number;
}

// The lines one edit takes out and puts in, unchanged lines kept for context, and a long change cut short.
export function EditDiff({ path = "", before, after, limit = 120 }: EditDiffProps) {
  const lines = edit_lines(before, after);
  const kept = lines.slice(0, limit);
  return (
    <div className="edit-diff">
      {path && <code className="diff-path">{path}</code>}
      <div className="diff-scroll">
        <table className="diff-lines" aria-label={path ? `Change to ${path}` : "Change"}>
          <tbody>
            {kept.map((line, index) => (
              <tr key={index} className={line.kind === "context" ? undefined : `diff-${line.kind}`}>
                <td className="diff-mark" aria-label={line.kind === "context" ? undefined : line.kind}>
                  {edit_marks[line.kind]}
                </td>
                <td className="diff-text">
                  <code>{line.text}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.length > kept.length && <p className="diff-note">{lines.length - kept.length} more lines left out.</p>}
    </div>
  );
}
