// A Preact table drawn like the page's own: it sorts by a column's header and turns into cards on phones.

import type { ComponentChildren } from "preact";
import { sorted_rows, type Sorting } from "../tables.ts";

export type { Sorting } from "../tables.ts";

// ── Table ────────────────────────────────────────────────────────────────────

export interface TableColumn<Row> {
  label: string;
  cell: (row: Row) => ComponentChildren;
  // A value to sort by; a column without one does not sort.
  sort?: (row: Row) => string | number | null;
  class?: string;
}

interface DataTableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  // A row's stable key, such as its id.
  row_key: (row: Row) => string | number;
  sorting?: Sorting;
  on_sort?: (sorting: Sorting) => void;
  caption?: string;
}

export function DataTable<Row>({ columns, rows, row_key, sorting, on_sort, caption }: DataTableProps<Row>) {
  const sort_column = sorting ? columns.find((column) => column.label === sorting.key && column.sort) : undefined;

  function header(column: TableColumn<Row>) {
    if (!column.sort || !on_sort) return <th key={column.label} class={column.class} scope="col">{column.label}</th>;
    const active = sort_column === column;
    const descending = active && sorting!.descending;
    return (
      <th key={column.label} class={column.class} scope="col" aria-sort={active ? (descending ? "descending" : "ascending") : "none"}>
        <button class="sort" onClick={() => on_sort({ key: column.label, descending: active ? !descending : false })}>
          {column.label}{active ? (descending ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  }

  return (
    <div class="table-wrap">
      <table class="responsive">
        {caption && <caption class="visually-hidden">{caption}</caption>}
        <thead><tr>{columns.map(header)}</tr></thead>
        <tbody>
          {sorted_rows(columns, rows, sorting).map((row) => (
            <tr key={row_key(row)}>
              {columns.map((column) => <td key={column.label} class={column.class} data-label={column.label}>{column.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
