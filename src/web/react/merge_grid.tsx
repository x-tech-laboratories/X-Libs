// A merge grid: records side by side, one row per field, each disagreement settled by picking the value that wins.

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../dom.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MergeField<Item> {
  id: string;
  label: string;
  value: (item: Item) => unknown;
  // How a value reads, which also decides whether two values agree; lists are joined by commas unless given.
  text?: (value: unknown) => string;
  // Offers Keep all, the records' values combined, such as every genre of every record; it is the default for the field.
  combine?: (values: unknown[]) => unknown;
}

// A field's winner: one record's value, or every record's values combined.
export type MergeChoice = { kind: "value"; from: string } | { kind: "combined" };

export type MergeChoices = Record<string, MergeChoice>;

export interface MergeGridLabels {
  field: string;
  result: string;
  survivor: string;
  take_all: string;
  keep_all: string;
  empty: string;
}

const DEFAULT_LABELS: MergeGridLabels = {
  field: "Field",
  result: "Result",
  survivor: "Survivor",
  take_all: "Take all from this",
  keep_all: "Keep all",
  empty: "Empty",
};

interface MergeGridProps<Item> {
  // The grid's caption for screen readers, such as "Tracks to merge".
  label: string;
  items: Item[];
  item_key: (item: Item) => string;
  // The record's column heading, "Record 1" and so on unless given.
  item_heading?: (item: Item, index: number) => ReactNode;
  // A line under the heading, such as how many files the record holds.
  item_detail?: (item: Item) => ReactNode;
  fields: MergeField<Item>[];
  // The record that stays, whose value wins every field left unpicked.
  survivor: string;
  on_survivor_change: (key: string) => void;
  choices: MergeChoices;
  on_choices_change: (choices: MergeChoices) => void;
  // Hides the fields every record agrees on.
  only_differences?: boolean;
  labels?: Partial<MergeGridLabels>;
}

// ── Merging ──────────────────────────────────────────────────────────────────

// A value as text: nothing for null or an empty string, lists joined by commas.
export function merge_text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(merge_text).filter((each) => each !== "").join(", ");
  return String(value);
}

export function is_conflict<Item>(field: MergeField<Item>, items: readonly Item[]): boolean {
  const text = field.text ?? merge_text;
  return new Set(items.map((item) => text(field.value(item)))).size > 1;
}

// Where a field's winner comes from: a record's key, or "combined".
export function winner_of<Item>(field: MergeField<Item>, items: readonly Item[], item_key: (item: Item) => string, survivor: string, choices: MergeChoices): string {
  const choice = choices[field.id];
  if (choice?.kind === "value" && items.some((item) => item_key(item) === choice.from)) return choice.from;
  if (field.combine && (choice?.kind === "combined" || choice === undefined)) return "combined";
  return survivor;
}

// The value each field ends up with, by field id, for the app to save.
export function merged_values<Item>(items: readonly Item[], item_key: (item: Item) => string, fields: readonly MergeField<Item>[], survivor: string, choices: MergeChoices): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const survivor_item = items.find((item) => item_key(item) === survivor) ?? items[0];
  for (const field of fields) {
    if (!is_conflict(field, items)) {
      merged[field.id] = survivor_item === undefined ? null : field.value(survivor_item);
      continue;
    }
    const winner = winner_of(field, items, item_key, survivor, choices);
    if (winner === "combined") merged[field.id] = field.combine!(items.map(field.value));
    else merged[field.id] = field.value(items.find((item) => item_key(item) === winner)!);
  }
  return merged;
}

// ── Grid ─────────────────────────────────────────────────────────────────────

// Text with a word for screen readers in place of the dash an empty value shows.
function ValueText({ text, empty }: { text: string; empty: string }) {
  if (text !== "") return <>{text}</>;
  return <><span aria-hidden="true">—</span><span className="visually-hidden">{empty}</span></>;
}

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

export function MergeGrid<Item>({
  label, items, item_key, item_heading = (_item, index) => `Record ${index + 1}`, item_detail, fields, survivor, on_survivor_change, choices,
  on_choices_change, only_differences = false, labels: own_labels,
}: MergeGridProps<Item>) {
  const labels = { ...DEFAULT_LABELS, ...own_labels };
  const table = useRef<HTMLTableElement>(null);
  const keys = items.map(item_key);
  const combined_column = items.length;
  const rows = fields.map((field) => ({ field, conflict: is_conflict(field, items) })).filter((row) => row.conflict || !only_differences);

  function pick(field: MergeField<Item>, choice: MergeChoice): void {
    on_choices_change({ ...choices, [field.id]: choice });
  }

  function take_all(key: string): void {
    const next: MergeChoices = { ...choices };
    for (const field of fields) if (is_conflict(field, items)) next[field.id] = { kind: "value", from: key };
    on_choices_change(next);
    on_survivor_change(key);
  }

  // The arrow keys move between the value buttons, across a field and to the same record in the next field that disagrees.
  function key_down(event: KeyboardEvent<HTMLTableElement>): void {
    const button = event.target as HTMLElement;
    if (!ARROWS.includes(event.key) || button.dataset.mergeRow === undefined) return;
    const row = Number(button.dataset.mergeRow);
    const column = Number(button.dataset.mergeColumn);
    const at = (row_at: number, column_at: number) => table.current!.querySelector<HTMLButtonElement>(`button[data-merge-row="${row_at}"][data-merge-column="${column_at}"]`);
    let target: HTMLButtonElement | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const step = event.key === "ArrowLeft" ? -1 : 1;
      for (let next = column + step; next >= 0 && next <= combined_column && !target; next += step) target = at(row, next);
    } else {
      const step = event.key === "ArrowUp" ? -1 : 1;
      for (let next = row + step; next >= 0 && next < rows.length && !target; next += step) target = at(next, column);
    }
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  return (
    <div className="table-wrap">
      <table ref={table} onKeyDown={key_down}>
        <caption className="visually-hidden">{label}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.field}</th>
            {items.map((item, index) => {
              const key = keys[index]!;
              return (
                <th key={key} scope="col" className={survivor === key ? "picked-column" : undefined}>
                  <div>{item_heading(item, index)}</div>
                  {item_detail && <div className="muted small">{item_detail(item)}</div>}
                  <div className="panel-tools">
                    <button type="button" aria-pressed={survivor === key} onClick={() => on_survivor_change(key)}>{labels.survivor}</button>
                    <button type="button" onClick={() => take_all(key)}>{labels.take_all}</button>
                  </div>
                </th>
              );
            })}
            <th scope="col">{labels.result}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ field, conflict }, row_index) => {
            const text = field.text ?? merge_text;
            const winner = conflict ? winner_of(field, items, item_key, survivor, choices) : null;
            const result = text(merged_values(items, item_key, [field], survivor, choices)[field.id]);
            return (
              <tr key={field.id}>
                <th scope="row" className={conflict ? undefined : "muted"}>{field.label}</th>
                {items.map((item, index) => {
                  const key = keys[index]!;
                  const value_text = text(field.value(item));
                  const column_class = survivor === key ? "picked-column" : undefined;
                  if (!conflict) return <td key={key} className={cx("muted", column_class)} title={value_text}><ValueText text={value_text} empty={labels.empty} /></td>;
                  return (
                    <td key={key} className={cx(column_class, winner === key && "picked") || undefined}>
                      <button
                        type="button" className="cell-button" aria-pressed={winner === key} title={value_text || labels.empty}
                        data-merge-row={row_index} data-merge-column={index}
                        onClick={() => pick(field, { kind: "value", from: key })}
                      >
                        <ValueText text={value_text} empty={labels.empty} />
                      </button>
                    </td>
                  );
                })}
                <td title={result}>
                  {conflict && field.combine && (
                    <button
                      type="button" aria-pressed={winner === "combined"}
                      data-merge-row={row_index} data-merge-column={combined_column}
                      onClick={() => pick(field, { kind: "combined" })}
                    >
                      {labels.keep_all}
                    </button>
                  )}
                  {" "}<strong><ValueText text={result} empty={labels.empty} /></strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
