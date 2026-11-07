// The order a sorted table shows its rows in, and the sorting a view's query asks for.

export interface Sorting {
  key: string;
  descending: boolean;
}

export interface SortableColumn<Row> {
  label: string;
  // A value to sort by; a column without one does not sort.
  sort?: (row: Row) => string | number | null;
}

// The rows in the order the sorting asks for, with rows missing a value last.
export function sorted_rows<Row>(columns: SortableColumn<Row>[], rows: Row[], sorting: Sorting | undefined): Row[] {
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
