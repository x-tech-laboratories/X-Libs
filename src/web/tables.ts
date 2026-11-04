// Tables that sort by a column's header and turn into cards on phones, with a pager for long lists.

import { h, type Child } from "./dom.ts";

// ── Columns ──────────────────────────────────────────────────────────────────

export interface Column<Row> {
  label: string;
  cell: (row: Row) => Child;
  // A value to sort by; a column without one does not sort.
  sort?: (row: Row) => string | number | null;
  class?: string;
}

export interface Sorting {
  key: string;
  descending: boolean;
}

export interface TableOptions {
  sorting?: Sorting;
  on_sort?: (sorting: Sorting) => void;
  caption?: string;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

// The rows in the order the sorting asks for, with rows missing a value last.
export function sorted_rows<Row>(columns: Pick<Column<Row>, "label" | "sort">[], rows: Row[], sorting: Sorting | undefined): Row[] {
  const column = sorting ? columns.find((candidate) => candidate.label === sorting.key && candidate.sort) : undefined;
  if (!sorting || !column?.sort) return rows;
  const value = column.sort;
  return [...rows].sort((left, right) => {
    const [first, second] = [value(left), value(right)];
    const order = first === second ? 0 : first === null ? 1 : second === null ? -1 : first < second ? -1 : 1;
    return sorting.descending ? -order : order;
  });
}

// The sorting a view's query asks for, such as ?sort=Name&dir=desc.
export function sorting_from(query: URLSearchParams, fallback: Sorting): Sorting {
  const key = query.get("sort");
  return key ? { key, descending: query.get("dir") === "desc" } : fallback;
}

// ── Tables ───────────────────────────────────────────────────────────────────

// A table whose cells carry their column's label, so phones can show each row as a card.
export function data_table<Row>(columns: Column<Row>[], rows: Row[], options: TableOptions = {}): HTMLElement {
  const sorting = options.sorting;
  const sort_column = sorting ? columns.find((column) => column.label === sorting.key && column.sort) : undefined;

  const header = (column: Column<Row>) => {
    if (!column.sort || !options.on_sort) return h("th", { class: column.class ?? null, scope: "col" }, column.label);
    const active = sort_column === column;
    const descending = active && sorting!.descending;
    return h("th", { class: column.class ?? null, scope: "col", "aria-sort": active ? (descending ? "descending" : "ascending") : "none" },
      h("button", {
        class: "sort",
        onclick: () => options.on_sort!({ key: column.label, descending: active ? !descending : false }),
      }, column.label, active ? (descending ? " ↓" : " ↑") : ""));
  };

  return h("div", { class: "table-wrap" },
    h("table", { class: "responsive" },
      options.caption ? h("caption", { class: "visually-hidden" }, options.caption) : null,
      h("thead", {}, h("tr", {}, ...columns.map(header))),
      h("tbody", {}, ...sorted_rows(columns, rows, sorting).map((row) => h("tr", {}, ...columns.map((column) =>
        h("td", { class: column.class ?? null, "data-label": column.label }, column.cell(row)))))),
    ),
  );
}

// ── Pages ────────────────────────────────────────────────────────────────────

// Newer and older buttons around the page number, or nothing when everything fits on one page.
export function pager(page: number, has_more: boolean, go: (page: number) => void): HTMLElement | null {
  if (page === 1 && !has_more) return null;
  return h("nav", { class: "pager", "aria-label": "Pages" },
    h("button", { disabled: page <= 1, onclick: () => go(page - 1) }, "← Newer"),
    h("span", { class: "muted" }, `Page ${page}`),
    h("button", { disabled: !has_more, onclick: () => go(page + 1) }, "Older →"));
}
