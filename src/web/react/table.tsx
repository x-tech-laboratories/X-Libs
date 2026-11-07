// A React table drawn like the page's own on TanStack Table: sorting by one column or several, columns the user moves, resizes,
// hides and filters, rows nested under rows, and cards on phones.

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { getCoreRowModel, getExpandedRowModel, getSortedRowModel, useReactTable, type ColumnDef, type ExpandedState, type Row as TanstackRow } from "@tanstack/react-table";
import { clamp_width, column_id, compare_values, move_column, ordered_columns, sort_after_click, sorting_list, type Sorting, type SortValue } from "../tables.ts";
import { ContextMenu, Popover } from "./menus.tsx";
import { ResizeHandle } from "./split.tsx";

export type { Sorting } from "../tables.ts";

// ── Columns ──────────────────────────────────────────────────────────────────

export interface TableColumn<Row> {
  label: string;
  // A name that stays put when the label changes, used by the sorting, order, widths and hidden columns; the label when not given.
  id?: string;
  cell: (row: Row) => ReactNode;
  // A value to sort by; a column without one does not sort, unless the table's rows come sorted.
  sort?: (row: Row) => string | number | null;
  // Set false to keep a click from sorting by it in a table whose rows come sorted.
  sortable?: boolean;
  class?: string;
  // The width it starts at and the narrowest and widest a drag may make it, in pixels.
  width?: number;
  min_width?: number;
  max_width?: number;
  // Whether the user may hide it or move it; both are allowed when not given.
  hideable?: boolean;
  movable?: boolean;
  // What the column's funnel button opens, such as a search box or MenuList choices; a function is handed the close.
  filter?: ReactNode | ((close: () => void) => ReactNode);
  // Lights the funnel up while the column's filter holds back rows.
  filter_active?: boolean;
}

interface DataTableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  // A row's stable key, such as its id; rows keep their place when there is none.
  row_key?: (row: Row) => string | number;
  caption?: string;

  // One sorting or several, the first deciding first.
  sorting?: Sorting | Sorting[];
  // The rows come already in order, such as from a database, so the table only shows and changes the sorting.
  manual_sorting?: boolean;
  // A click sorts by one column, flipping it on a second click.
  on_sort?: (sorting: Sorting) => void;
  // A click sorts by one column and Shift+click adds or flips one; a third click takes a column out.
  on_sorting_change?: (sorting: Sorting[]) => void;

  // Column ids in the order shown; dragging a header, or Alt+arrow on it, moves a column.
  column_order?: string[];
  on_column_order_change?: (order: string[]) => void;
  // Widths in pixels by column id; called as an edge is dragged, then with done once it is let go.
  column_widths?: Record<string, number>;
  on_column_widths_change?: (widths: Record<string, number>, done: boolean) => void;
  // Column ids the user has hidden; a Columns button and right-clicking the header choose them.
  hidden_columns?: string[];
  on_hidden_columns_change?: (hidden: string[]) => void;

  // Keeps only the rows that pass, and in a tree the rows above any that pass.
  row_passes?: (row: Row) => boolean;
  // Shows a Clear filters button while any column's filter is active.
  on_clear_filters?: () => void;

  // The rows nested under a row, which makes the table a tree sorted level by level.
  get_children?: (row: Row) => Row[] | undefined;
  // Keys of the open rows, from row_key, or true for all of them; every row is open when not given.
  expanded?: string[] | true;
  on_expanded_change?: (expanded: string[]) => void;

  on_row_click?: (row: Row, event: MouseEvent<HTMLTableRowElement>) => void;
  on_row_context_menu?: (row: Row, event: MouseEvent<HTMLTableRowElement>) => void;
  on_row_double_click?: (row: Row, event: MouseEvent<HTMLTableRowElement>) => void;
  // Makes the rows focusable, the active one in the Tab order, and hands on their keys.
  on_row_key_down?: (row: Row, event: KeyboardEvent<HTMLTableRowElement>) => void;
  // The row_key of the row Tab reaches, such as the keyboard cursor.
  active_row?: string | number;
  // Marks a row picked for assistive technology.
  row_selected?: (row: Row) => boolean;
  // A class for a row, such as one that marks it picked.
  row_class?: (row: Row) => string | undefined;
}

const is_empty = (value: SortValue): boolean => value === null || value === undefined || value === "";

// The rows that pass and, in a tree, those above a row that passes, with each row's passing children.
function filtered_tree<Row>(rows: Row[], passes: (row: Row) => boolean, get_children: ((row: Row) => Row[] | undefined) | undefined, kept_children: Map<Row, Row[]>): Row[] {
  return rows.filter((row) => {
    const children = get_children ? filtered_tree(get_children(row) ?? [], passes, get_children, kept_children) : [];
    kept_children.set(row, children);
    return passes(row) || children.length > 0;
  });
}

// ── Table ────────────────────────────────────────────────────────────────────

export function DataTable<Row>(props: DataTableProps<Row>) {
  const { columns, rows, row_key, caption, get_children, row_passes } = props;
  const [own_expanded, set_own_expanded] = useState<string[] | true>(true);
  const [open_filter, set_open_filter] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const filter_closed = useRef({ id: "", at: 0 });
  const [columns_menu, set_columns_menu] = useState<{ x: number; y: number } | null>(null);
  const [dragged, set_dragged] = useState<string | null>(null);
  const [drop_target, set_drop_target] = useState<{ id: string; after: boolean } | null>(null);
  const resizing = useRef(false);
  const header_cells = useRef(new Map<string, HTMLTableCellElement>());
  const [measured, set_measured] = useState<Record<string, number>>({});

  const by_id = useMemo(() => new Map(columns.map((column) => [column_id(column), column])), [columns]);
  const all_ids = columns.map(column_id);
  const manual = props.manual_sorting === true;
  const is_sortable = (column: TableColumn<Row> | undefined): boolean => Boolean(column) && (manual ? column!.sortable !== false : Boolean(column!.sort));
  // Rows that come sorted keep every key, even one naming no column, so a click never drops it.
  const sorting = manual ? sorting_list(props.sorting) : sorting_list(props.sorting).filter((key) => is_sortable(by_id.get(key.key)));
  const hidden = props.hidden_columns ?? [];
  const widths = props.column_widths ?? {};
  const expanded = props.expanded ?? own_expanded;
  const tree = get_children !== undefined;

  // ── Rows ──

  const { data, children_of } = useMemo(() => {
    if (!row_passes) return { data: rows, children_of: get_children };
    const kept_children = new Map<Row, Row[]>();
    const kept = filtered_tree(rows, row_passes, get_children, kept_children);
    return { data: kept, children_of: get_children && ((row: Row) => kept_children.get(row) ?? []) };
  }, [rows, row_passes, get_children]);

  // TanStack flips a descending column's order, so an empty value is flipped first to stay last.
  const descending = useRef(new Set<string>());
  descending.current = new Set(sorting.filter((key) => key.descending).map((key) => key.key));

  const definitions = useMemo(() => columns.map((column): ColumnDef<Row, SortValue> => ({
    id: column_id(column),
    accessorFn: column.sort,
    enableSorting: Boolean(column.sort),
    sortingFn: (left, right, id) => {
      const [first, second] = [left.getValue<SortValue>(id), right.getValue<SortValue>(id)];
      const order = compare_values(first, second);
      return (is_empty(first) || is_empty(second)) && descending.current.has(id) ? -order : order;
    },
  })), [columns]);

  const table = useReactTable<Row>({
    data,
    columns: definitions,
    getRowId: row_key ? (row) => String(row_key(row)) : undefined,
    getSubRows: children_of ? (row) => children_of(row) ?? [] : undefined,
    state: {
      sorting: sorting.filter((key) => by_id.has(key.key)).map((key) => ({ id: key.key, desc: key.descending })),
      columnOrder: ordered_columns(props.column_order ?? all_ids, all_ids),
      columnVisibility: Object.fromEntries(hidden.map((id) => [id, false])),
      expanded: expanded === true ? true : Object.fromEntries(expanded.map((id) => [id, true])) as ExpandedState,
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: (row) => row.subRows.length > 0,
    manualSorting: manual,
  });

  const shown = table.getVisibleLeafColumns().map((column) => by_id.get(column.id)!);

  function toggle_row(row: TanstackRow<Row>): void {
    const open = expanded === true
      ? table.getCoreRowModel().flatRows.filter((each) => each.subRows.length > 0).map((each) => each.id)
      : expanded;
    const next = row.getIsExpanded() ? open.filter((id) => id !== row.id) : [...open, row.id];
    if (props.expanded === undefined) set_own_expanded(next);
    props.on_expanded_change?.(next);
  }

  // ── Sorting ──

  function sort_by(id: string, adding: boolean): void {
    if (props.on_sorting_change) return props.on_sorting_change(sort_after_click(sorting, id, adding));
    const current = sorting.find((key) => key.key === id);
    props.on_sort?.({ key: id, descending: current ? !current.descending : false });
  }

  // ── Widths ──

  const width_of = (column: TableColumn<Row>): number | undefined => widths[column_id(column)] ?? column.width;

  // A column never sized is measured, so the first drag of its edge starts from where it is.
  useLayoutEffect(() => {
    if (!props.on_column_widths_change) return;
    const sizes = Object.fromEntries([...header_cells.current].map(([id, cell]) => [id, cell.offsetWidth]));
    set_measured((before) => JSON.stringify(before) === JSON.stringify(sizes) ? before : sizes);
  }, [shown.map(column_id).join("\n"), props.on_column_widths_change]);

  function resize(column: TableColumn<Row>, width: number, done: boolean): void {
    props.on_column_widths_change?.({ ...widths, [column_id(column)]: width }, done);
  }

  // ── Moving ──

  const can_move = (column: TableColumn<Row>): boolean => Boolean(props.on_column_order_change) && column.movable !== false;
  const order = (): string[] => table.getState().columnOrder;

  function move(id: string, target: string, after: boolean): void {
    if (id !== target) props.on_column_order_change?.(move_column(order(), id, target, after));
  }

  // A column dropped on the left half of another goes before it, and on the right half after it.
  function drag_over(column: TableColumn<Row>, event: DragEvent<HTMLTableCellElement>): void {
    if (!dragged || !can_move(column)) return;
    event.preventDefault();
    const cell = event.currentTarget.getBoundingClientRect();
    set_drop_target({ id: column_id(column), after: event.clientX > cell.left + cell.width / 2 });
  }

  function drop(event: DragEvent<HTMLTableCellElement>): void {
    event.preventDefault();
    if (dragged && drop_target) move(dragged, drop_target.id, drop_target.after);
    set_dragged(null);
    set_drop_target(null);
  }

  // Alt with an arrow moves the column one place along, past any hidden ones.
  function move_by_key(column: TableColumn<Row>, event: KeyboardEvent<HTMLElement>): void {
    if (!event.altKey || !can_move(column) || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const ids = shown.map(column_id);
    const index = ids.indexOf(column_id(column));
    const target = ids[index + (event.key === "ArrowLeft" ? -1 : 1)];
    if (target && by_id.get(target)?.movable !== false) move(column_id(column), target, event.key === "ArrowRight");
  }

  // ── Filters ──

  function toggle_filter(id: string, anchor: HTMLElement): void {
    // The click that closed the popover by landing outside it is the same one that reaches its button.
    const just_closed = filter_closed.current.id === id && Date.now() - filter_closed.current.at < 300;
    set_open_filter(open_filter?.id === id || just_closed ? null : { id, anchor });
  }

  function close_filter(): void {
    if (open_filter) filter_closed.current = { id: open_filter.id, at: Date.now() };
    set_open_filter(null);
  }

  const any_filter = columns.some((column) => column.filter_active);

  // ── Hiding ──

  function open_columns_menu(event: MouseEvent<HTMLElement>): void {
    if (!props.on_hidden_columns_change) return;
    event.preventDefault();
    if (event.type === "contextmenu") return set_columns_menu({ x: event.clientX, y: event.clientY });
    const button = event.currentTarget.getBoundingClientRect();
    set_columns_menu({ x: button.left, y: button.bottom + 4 });
  }

  const column_choices = columns.map((column) => {
    const id = column_id(column);
    const visible = !hidden.includes(id);
    // The last column on show stays, so the table never empties.
    const fixed = column.hideable === false || (visible && shown.length === 1);
    return { label: column.label, checked: visible, disabled: fixed, keep_open: true, run: () => props.on_hidden_columns_change!(visible ? [...hidden, id] : hidden.filter((each) => each !== id)) };
  });

  // ── Drawing ──

  function header(column: TableColumn<Row>) {
    const id = column_id(column);
    const index = sorting.findIndex((key) => key.key === id);
    const key = sorting[index];
    const sortable = is_sortable(column) && Boolean(props.on_sort || props.on_sorting_change);
    const width = width_of(column);
    const movable = can_move(column);
    const class_name = [
      column.class, column.filter_active && "filtered", dragged === id && "dragged", drop_target?.id === id && (drop_target.after ? "drop-after" : "drop-before"),
    ].filter(Boolean).join(" ") || undefined;
    const marker = key && (
      <span className="sort-marker" aria-hidden="true">
        {key.descending ? " ↓" : " ↑"}{sorting.length > 1 && <sup className="sort-rank">{index + 1}</sup>}
      </span>
    );

    return (
      <th
        key={id}
        ref={(cell) => { if (cell) header_cells.current.set(id, cell); else header_cells.current.delete(id); }}
        className={class_name}
        scope="col"
        style={width === undefined ? undefined : { width, minWidth: width, maxWidth: width }}
        aria-sort={sortable ? (key ? (key.descending ? "descending" : "ascending") : "none") : undefined}
        draggable={movable || undefined}
        title={movable ? "Drag to move this column" : undefined}
        onPointerDownCapture={(event) => { resizing.current = (event.target as HTMLElement).classList.contains("resize-handle"); }}
        onDragStart={(event) => {
          if (resizing.current) return event.preventDefault();
          event.dataTransfer.setData("text/plain", id);
          set_dragged(id);
        }}
        onDragEnd={() => { set_dragged(null); set_drop_target(null); }}
        onDragOver={(event) => drag_over(column, event)}
        onDragLeave={() => set_drop_target(null)}
        onDrop={drop}
      >
        {sortable ? (
          <button
            type="button"
            className="sort"
            title={props.on_sorting_change ? "Click to sort by this column, Shift+click to add it to the sort" : undefined}
            onClick={(event) => sort_by(id, event.shiftKey)}
            onKeyDown={(event) => move_by_key(column, event)}
          >
            {column.label}{marker}
          </button>
        ) : movable ? (
          <span tabIndex={0} onKeyDown={(event) => move_by_key(column, event)}>{column.label}</span>
        ) : column.label}
        {column.filter !== undefined && (
          <button
            type="button"
            className={column.filter_active ? "icon filter-button active" : "icon filter-button"}
            aria-label={`Filter by ${column.label}`}
            aria-expanded={open_filter?.id === id}
            title={column.filter_active ? `Filtered by ${column.label}` : `Filter by ${column.label}`}
            onClick={(event) => toggle_filter(id, event.currentTarget)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6z" fill="currentColor" /></svg>
          </button>
        )}
        {props.on_column_widths_change && (
          <ResizeHandle
            side="left"
            size={width ?? measured[id] ?? column.min_width ?? 48}
            min={column.min_width ?? 48}
            max={column.max_width ?? 960}
            default_size={clamp_width(column.width ?? measured[id] ?? 120, column.min_width, column.max_width)}
            on_resize={(size) => resize(column, size, false)}
            on_resize_end={(size) => resize(column, size, true)}
            label={`Resize the ${column.label} column`}
            class_name="column-resize"
          />
        )}
      </th>
    );
  }

  function body_row(row: TanstackRow<Row>) {
    const original = row.original;
    const extra = props.row_class?.(original);
    const keyed = props.on_row_key_down !== undefined;
    const key = row_key ? String(row_key(original)) : row.id;
    return (
      <tr
        key={row.id}
        className={extra}
        data-row-key={keyed ? key : undefined}
        tabIndex={keyed ? (props.active_row !== undefined && String(props.active_row) === key ? 0 : -1) : undefined}
        aria-selected={props.row_selected ? props.row_selected(original) : undefined}
        onClick={props.on_row_click && ((event) => props.on_row_click!(original, event))}
        onDoubleClick={props.on_row_double_click && ((event) => props.on_row_double_click!(original, event))}
        onKeyDown={props.on_row_key_down && ((event) => props.on_row_key_down!(original, event))}
        onContextMenu={props.on_row_context_menu && ((event) => props.on_row_context_menu!(original, event))}
      >
        {shown.map((column, index) => {
          const label = column.label;
          if (!tree || index > 0) return <td key={column_id(column)} className={column.class} data-label={label}>{column.cell(original)}</td>;
          const open = row.getIsExpanded();
          const count = row.subRows.length;
          return (
            <td key={column_id(column)} className={[column.class, "tree-cell"].filter(Boolean).join(" ")} data-label={label} style={{ "--tree-depth": row.depth } as CSSProperties}>
              {count > 0 ? (
                <button type="button" className="icon tree-toggle" aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} onClick={(event) => { event.stopPropagation(); toggle_row(row); }}>
                  {open ? "▾" : "▸"}
                </button>
              ) : <span className="tree-spacer" />}
              {column.cell(original)}
              {count > 0 && !open && <span className="tree-count" title={`${count} inside`}>{count}</span>}
            </td>
          );
        })}
      </tr>
    );
  }

  const filtered_column = open_filter ? by_id.get(open_filter.id) : undefined;
  const filter_body = filtered_column?.filter;
  const tools = (props.on_clear_filters && any_filter) || props.on_hidden_columns_change;

  return (
    <>
      {tools && (
        <div className="table-tools">
          {props.on_clear_filters && any_filter && <button type="button" onClick={props.on_clear_filters}>Clear filters</button>}
          {props.on_hidden_columns_change && <button type="button" aria-haspopup="menu" onClick={open_columns_menu}>Columns</button>}
        </div>
      )}
      <div className="table-wrap">
        <table className="responsive">
          {caption && <caption className="visually-hidden">{caption}</caption>}
          <thead onContextMenu={props.on_hidden_columns_change && open_columns_menu}><tr>{shown.map(header)}</tr></thead>
          <tbody>{table.getRowModel().rows.map(body_row)}</tbody>
        </table>
      </div>
      {open_filter && filtered_column && filter_body !== undefined && (
        <Popover anchor={open_filter.anchor} label={`Filter by ${filtered_column.label}`} on_close={close_filter}>
          {typeof filter_body === "function" ? filter_body(close_filter) : filter_body}
        </Popover>
      )}
      {columns_menu && <ContextMenu x={columns_menu.x} y={columns_menu.y} label="Columns" items={column_choices} on_close={() => set_columns_menu(null)} />}
    </>
  );
}

// ── Pages ────────────────────────────────────────────────────────────────────

// Newer and older buttons around the page number, or nothing when everything fits on one page.
export function Pager({ page, has_more, go }: { page: number; has_more: boolean; go: (page: number) => void }) {
  if (page === 1 && !has_more) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button disabled={page <= 1} onClick={() => go(page - 1)}>← Newer</button>
      <span className="muted">Page {page}</span>
      <button disabled={!has_more} onClick={() => go(page + 1)}>Older →</button>
    </nav>
  );
}
