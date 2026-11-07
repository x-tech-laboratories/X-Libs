// The order a sorted table shows its rows in, the sorting a click or a view's query asks for, and the order of its columns.

// ── Sorting ──────────────────────────────────────────────────────────────────

export interface Sorting {
  // The column's id, which is its label unless it names another.
  key: string;
  descending: boolean;
}

export interface SortableColumn<Row> {
  label: string;
  // A name that stays put when the label changes, such as for saved widths and order.
  id?: string;
  // A value to sort by; a column without one does not sort.
  sort?: (row: Row) => string | number | null;
}

export type SortValue = string | number | null | undefined;

export function column_id(column: { id?: string; label: string }): string {
  return column.id ?? column.label;
}

// One sorting or several as a list, the first deciding first.
export function sorting_list(sorting: Sorting | readonly Sorting[] | undefined): Sorting[] {
  if (!sorting) return [];
  return Array.isArray(sorting) ? [...sorting] : [sorting as Sorting];
}

const is_empty = (value: SortValue): boolean => value === null || value === undefined || value === "";

// Numbers by size and text by its words and numbers, with an empty value last whichever way the column sorts.
export function compare_values(first: SortValue, second: SortValue, descending = false): number {
  if (is_empty(first) || is_empty(second)) return Number(is_empty(first)) - Number(is_empty(second));
  const order = typeof first === "number" && typeof second === "number"
    ? first - second
    : String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: "base" });
  return descending ? -order : order;
}

// The rows in the order the sortings ask for, the later ones breaking ties, and rows missing a value last.
export function sorted_rows<Row>(columns: SortableColumn<Row>[], rows: Row[], sorting: Sorting | readonly Sorting[] | undefined): Row[] {
  const keys = sorting_list(sorting).flatMap((key) => {
    const column = columns.find((candidate) => column_id(candidate) === key.key && candidate.sort);
    return column?.sort ? [{ value: column.sort, descending: key.descending }] : [];
  });
  if (keys.length === 0) return rows;
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const order = compare_values(key.value(left), key.value(right), key.descending);
      if (order !== 0) return order;
    }
    return 0;
  });
}

export interface TreeRow<Row> {
  row: Row;
  children: TreeRow<Row>[];
}

// Sorts each level of a tree on its own, so children stay under their parents.
export function sorted_tree<Row>(columns: SortableColumn<Row>[], rows: Row[], sorting: Sorting | readonly Sorting[] | undefined, get_children: (row: Row) => Row[] | undefined): TreeRow<Row>[] {
  return sorted_rows(columns, rows, sorting).map((row) => ({ row, children: sorted_tree(columns, get_children(row) ?? [], sorting, get_children) }));
}

// A plain click sorts by that column alone; a Shift+click adds it to the sort or flips it; a third click takes it out.
export function sort_after_click(sorting: readonly Sorting[], key: string, adding: boolean): Sorting[] {
  const current = sorting.find((each) => each.key === key);
  const next: Sorting | null = !current ? { key, descending: false } : current.descending ? null : { key, descending: true };

  if (!adding) {
    if (current && sorting.length === 1) return next ? [next] : [];
    return [{ key, descending: false }];
  }

  if (!current) return [...sorting, next!];
  return next ? sorting.map((each) => (each.key === key ? next : each)) : sorting.filter((each) => each.key !== key);
}

// The sorting a view's query asks for, such as ?sort=Name&dir=desc.
export function sorting_from(query: URLSearchParams, fallback: Sorting): Sorting {
  const key = query.get("sort");
  return key ? { key, descending: query.get("dir") === "desc" } : fallback;
}

// ── Columns ──────────────────────────────────────────────────────────────────

// Every column in its saved order, leaving out ones gone since and placing a new one just after the column before it.
export function ordered_columns(saved_order: readonly string[], all_columns: readonly string[]): string[] {
  const ordered = saved_order.filter((column, index) => all_columns.includes(column) && saved_order.indexOf(column) === index);
  all_columns.forEach((column, index) => {
    if (ordered.includes(column)) return;
    ordered.splice(index === 0 ? 0 : ordered.indexOf(all_columns[index - 1]!) + 1, 0, column);
  });
  return ordered;
}

// Moves a column to just before or after another one.
export function move_column(order: readonly string[], column: string, target: string, after: boolean): string[] {
  const rest = order.filter((each) => each !== column);
  const index = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, index), column, ...rest.slice(index)];
}

// A width held between the column's narrowest and widest.
export function clamp_width(width: number, min = 48, max = 960): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}
