// A React table drawn like the page's own on TanStack Table: sorting by one column or several, columns the user moves, resizes,
// hides and filters, rows nested under rows, rows in groups under headings, rows dragged by the app's rules, long lists drawn
// only where they show, and cards on phones.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { getCoreRowModel, getExpandedRowModel, getSortedRowModel, useReactTable, type ColumnDef, type ExpandedState, type Row as TanstackRow } from "@tanstack/react-table";
import { clamp_width, column_id, compare_values, move_column, ordered_columns, sort_after_click, sorting_list, type Sorting, type SortValue } from "../tables.ts";
import { placement_at, type DropPlacement } from "../tree.ts";
import { virtual_window } from "../virtual.ts";
import { ContextMenu, Popover } from "./menus.tsx";
import { ResizeHandle } from "./split.tsx";

export type { Sorting } from "../tables.ts";
export type { DropPlacement } from "../tree.ts";

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

export interface RowGroup<Row> {
  key: string;
  label: ReactNode;
  rows: Row[];
  class_name?: string;
}

// Draws only the rows in view; the table's .table-wrap scrolls, so the app gives it a height.
export interface TableVirtual {
  // Every row's height in pixels, group headings included.
  row_height: number;
  // How many rows past each edge of the view are drawn too.
  overscan?: number;
  // A phone card's height in pixels; phones draw every row when it is left out.
  card_height?: number;
}

interface DataTableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  // Rows under headings, each group sorted on its own; used in place of `rows`; a heading hides while the filter empties its group.
  groups?: RowGroup<Row>[];
  // A row's stable key, such as its id; rows keep their place when there is none.
  row_key?: (row: Row) => string | number;
  caption?: string;
  virtual?: TableVirtual;
  // Lets the last column on show take the room the others' fixed widths leave.
  fill_last_column?: boolean;

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
  // A row's hover text.
  row_title?: (row: Row) => string | undefined;
  // Inline style for a row, such as a custom property its cells read for a tint.
  row_style?: (row: Row) => CSSProperties | undefined;
  // A full-width row after a row, such as an inline form for a new child; a virtual table counts it in its row's height.
  render_after_row?: (row: Row) => ReactNode;

  // Makes rows draggable; the app decides what moves, such as every picked row.
  on_row_drag_start?: (row: Row, event: DragEvent<HTMLTableRowElement>) => void;
  on_row_drag_end?: () => void;
  // Where a dragged row may land on this row; without it only a drag started in this table lands, anywhere.
  can_drop_on_row?: (row: Row, placement: DropPlacement) => boolean;
  // Whether a row's middle drops inside it, splitting rows into quarters, or only beside it, splitting them into halves.
  allow_inside_drop?: boolean;
  on_row_drop?: (row: Row, placement: DropPlacement, event: DragEvent<HTMLTableRowElement>) => void;
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

// ── Rows ─────────────────────────────────────────────────────────────────────

// What a row hands back to the table, read from the table's latest draw.
interface RowEvents<Row> {
  click: (row: Row, event: MouseEvent<HTMLTableRowElement>) => void;
  double_click: (row: Row, event: MouseEvent<HTMLTableRowElement>) => void;
  context_menu: (row: Row, event: MouseEvent<HTMLTableRowElement>) => void;
  key_down: (row: Row, event: KeyboardEvent<HTMLTableRowElement>) => void;
  toggle: (id: string, open: boolean) => void;
  drag_start: (row: Row, id: string, event: DragEvent<HTMLTableRowElement>) => void;
  drag_end: () => void;
  drag_over: (row: Row, id: string, event: DragEvent<HTMLTableRowElement>) => void;
  drag_leave: (id: string) => void;
  drop: (row: Row, id: string, event: DragEvent<HTMLTableRowElement>) => void;
}

interface TableRowProps<Row> {
  original: Row;
  id: string;
  row_key: string;
  depth: number;
  open: boolean;
  child_count: number;
  columns: TableColumn<Row>[];
  tree: boolean;
  class_name: string | undefined;
  title: string | undefined;
  style: CSSProperties | undefined;
  selected: boolean | undefined;
  tab_index: number | undefined;
  keyed: boolean;
  draggable: boolean;
  after: ReactNode;
  events: RefObject<RowEvents<Row>>;
}

function TableRowView<Row>(props: TableRowProps<Row>) {
  const { original, id, columns, events } = props;
  const after = props.after;
  return (
    <>
      <tr
        className={props.class_name}
        title={props.title}
        style={props.style}
        data-row-key={props.keyed ? props.row_key : undefined}
        tabIndex={props.tab_index}
        aria-selected={props.selected}
        draggable={props.draggable || undefined}
        onDragStart={props.draggable ? (event) => events.current.drag_start(original, id, event) : undefined}
        onDragEnd={props.draggable ? () => events.current.drag_end() : undefined}
        onDragOver={(event) => events.current.drag_over(original, id, event)}
        onDragLeave={() => events.current.drag_leave(id)}
        onDrop={(event) => events.current.drop(original, id, event)}
        onClick={(event) => events.current.click(original, event)}
        onDoubleClick={(event) => events.current.double_click(original, event)}
        onKeyDown={(event) => events.current.key_down(original, event)}
        onContextMenu={(event) => events.current.context_menu(original, event)}
      >
        {columns.map((column, index) => {
          const label = column.label;
          if (!props.tree || index > 0) return <td key={column_id(column)} className={column.class} data-label={label}>{column.cell(original)}</td>;
          const count = props.child_count;
          return (
            <td key={column_id(column)} className={[column.class, "tree-cell"].filter(Boolean).join(" ")} data-label={label} style={{ "--tree-depth": props.depth } as CSSProperties}>
              {count > 0 ? (
                <button type="button" className="icon tree-toggle" aria-expanded={props.open} aria-label={props.open ? "Collapse" : "Expand"} onClick={(event) => { event.stopPropagation(); events.current.toggle(id, props.open); }}>
                  {props.open ? "▾" : "▸"}
                </button>
              ) : <span className="tree-spacer" />}
              {column.cell(original)}
              {count > 0 && !props.open && <span className="tree-count" title={`${count} inside`}>{count}</span>}
            </td>
          );
        })}
      </tr>
      {after !== undefined && after !== null && typeof after !== "boolean" && <tr className="row-extra"><td colSpan={columns.length}>{after}</td></tr>}
    </>
  );
}

function same_style(first: CSSProperties | undefined, second: CSSProperties | undefined): boolean {
  if (first === second) return true;
  if (!first || !second) return false;
  const keys = Object.keys(first) as (keyof CSSProperties)[];
  return keys.length === Object.keys(second).length && keys.every((key) => first[key] === second[key]);
}

function same_row<Row>(before: TableRowProps<Row>, after: TableRowProps<Row>): boolean {
  return (Object.keys(after) as (keyof TableRowProps<Row>)[]).every((key) => key === "style" ? same_style(before.style, after.style) : before[key] === after[key]);
}

// A row draws again only when something it shows changes, so picking one row leaves the others alone.
const TableRow = memo(TableRowView, same_row) as <Row>(props: TableRowProps<Row> & { key?: string }) => ReactElement;

// A group's heading or one of the rows, in the order drawn.
type Line<Row> = { kind: "group"; group: RowGroup<Row> } | { kind: "row"; row: TanstackRow<Row>; key: string };

// Whether the page is phone-sized, where the rows are cards.
function use_phone(): boolean {
  const query = "(max-width: 640px)";
  const [phone, set_phone] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const changed = () => set_phone(list.matches);
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, []);
  return phone;
}

// ── Table ────────────────────────────────────────────────────────────────────

export function DataTable<Row>(props: DataTableProps<Row>) {
  const { columns, row_key, caption, get_children, row_passes, groups, allow_inside_drop = true, fill_last_column: fill_last = false } = props;
  const rows = useMemo(() => groups ? groups.flatMap((group) => group.rows) : props.rows, [groups, props.rows]);
  const [own_expanded, set_own_expanded] = useState<string[] | true>(true);
  const [open_filter, set_open_filter] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const filter_closed = useRef({ id: "", at: 0 });
  const [columns_menu, set_columns_menu] = useState<{ x: number; y: number } | null>(null);
  const [dragged, set_dragged] = useState<string | null>(null);
  const [drop_target, set_drop_target] = useState<{ id: string; after: boolean } | null>(null);
  const resizing = useRef(false);
  const header_cells = useRef(new Map<string, HTMLTableCellElement>());
  const [measured, set_measured] = useState<Record<string, number>>({});
  const [row_dragging, set_row_dragging] = useState(false);
  const [row_drop, set_row_drop] = useState<{ id: string; placement: DropPlacement } | null>(null);

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

  const shown_ids = table.getVisibleLeafColumns().map((column) => column.id).join("\n");
  const shown = useMemo(() => shown_ids.split("\n").filter(Boolean).map((id) => by_id.get(id)!), [shown_ids, by_id]);

  function toggle_row(id: string, is_open: boolean): void {
    const open = expanded === true
      ? table.getCoreRowModel().flatRows.filter((each) => each.subRows.length > 0).map((each) => each.id)
      : expanded;
    const next = is_open ? open.filter((each) => each !== id) : [...open, id];
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
  }, [shown_ids, props.on_column_widths_change]);

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

  // ── Dragging rows ──

  // A drag started in this table lands anywhere, and any drag lands where the app's rule allows it.
  function row_placement(row: Row, event: DragEvent<HTMLTableRowElement>): DropPlacement | null {
    if (!props.on_row_drop) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const placement = placement_at(box.height > 0 ? (event.clientY - box.top) / box.height : 0.5, allow_inside_drop);
    const allowed = props.can_drop_on_row ? props.can_drop_on_row(row, placement) : row_dragging;
    return allowed ? placement : null;
  }

  function row_drag_start(row: Row, id: string, event: DragEvent<HTMLTableRowElement>): void {
    set_row_dragging(true);
    props.on_row_drag_start!(row, event);
    // Some browsers start a drag only once it carries data.
    if (event.dataTransfer && event.dataTransfer.types.length === 0) event.dataTransfer.setData("text/plain", id);
  }

  function row_drag_over(row: Row, id: string, event: DragEvent<HTMLTableRowElement>): void {
    const placement = row_placement(row, event);
    if (!placement) {
      if (row_drop?.id === id) set_row_drop(null);
      return;
    }
    event.preventDefault();
    if (row_drop?.id !== id || row_drop.placement !== placement) set_row_drop({ id, placement });
  }

  function row_drag_drop(row: Row, event: DragEvent<HTMLTableRowElement>): void {
    const placement = row_placement(row, event);
    set_row_drop(null);
    if (!placement) return;
    event.preventDefault();
    props.on_row_drop!(row, placement, event);
  }

  function row_drag_end(): void {
    set_row_dragging(false);
    set_row_drop(null);
    props.on_row_drag_end?.();
  }

  // The rows read these through a ref, so a new handler from the app never draws every row again.
  const events = useRef<RowEvents<Row>>(null!);
  events.current = {
    click: (row, event) => props.on_row_click?.(row, event),
    double_click: (row, event) => props.on_row_double_click?.(row, event),
    context_menu: (row, event) => props.on_row_context_menu?.(row, event),
    key_down: (row, event) => props.on_row_key_down?.(row, event),
    toggle: toggle_row,
    drag_start: row_drag_start,
    drag_end: row_drag_end,
    drag_over: (row, id, event) => { if (props.on_row_drop) row_drag_over(row, id, event); },
    drag_leave: (id) => { if (props.on_row_drop && row_drop?.id === id) set_row_drop(null); },
    drop: (row, _id, event) => { if (props.on_row_drop) row_drag_drop(row, event); },
  };

  // ── Drawing ──

  function header(column: TableColumn<Row>) {
    const id = column_id(column);
    const index = sorting.findIndex((key) => key.key === id);
    const key = sorting[index];
    const sortable = is_sortable(column) && Boolean(props.on_sort || props.on_sorting_change);
    const filling = fill_last && column === shown[shown.length - 1];
    const width = filling ? undefined : width_of(column);
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
        style={width !== undefined ? { width, minWidth: width, maxWidth: width } : filling && column.min_width !== undefined ? { minWidth: column.min_width } : undefined}
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
        {props.on_column_widths_change && !filling && (
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

  function body_row(row: TanstackRow<Row>, key: string) {
    const original = row.original;
    const keyed = props.on_row_key_down !== undefined;
    return (
      <TableRow<Row>
        key={row.id}
        original={original}
        id={row.id}
        row_key={key}
        depth={row.depth}
        open={row.getIsExpanded()}
        child_count={row.subRows.length}
        columns={shown}
        tree={tree}
        class_name={[props.row_class?.(original), row_drop?.id === row.id && `drop-${row_drop.placement}`].filter(Boolean).join(" ") || undefined}
        title={props.row_title?.(original)}
        style={props.row_style?.(original)}
        selected={props.row_selected?.(original)}
        tab_index={keyed ? (props.active_row !== undefined && String(props.active_row) === key ? 0 : -1) : undefined}
        keyed={keyed}
        draggable={Boolean(props.on_row_drag_start)}
        after={props.render_after_row?.(original)}
        events={events}
      />
    );
  }

  const row_line = (row: TanstackRow<Row>): Line<Row> => ({ kind: "row", row, key: row_key ? String(row_key(row.original)) : row.id });

  // Each group's heading and then its rows, which keep the order of the sorted whole, so each group is sorted on its own.
  function grouped_lines(groups: RowGroup<Row>[]): Line<Row>[] {
    const group_of = new Map<Row, number>();
    groups.forEach((group, index) => group.rows.forEach((row) => { if (!group_of.has(row)) group_of.set(row, index); }));
    const rows_by_group = groups.map((): TanstackRow<Row>[] => []);
    let current = 0;
    for (const row of table.getRowModel().rows) {
      if (row.depth === 0) current = group_of.get(row.original) ?? current;
      rows_by_group[current]!.push(row);
    }
    // A group the filter emptied loses its heading, while one that was empty all along keeps it.
    return groups.flatMap((group, index) => rows_by_group[index]!.length === 0 && group.rows.length > 0
      ? []
      : [{ kind: "group" as const, group }, ...rows_by_group[index]!.map(row_line)]);
  }

  const lines = groups ? grouped_lines(groups) : table.getRowModel().rows.map(row_line);

  // ── Virtual rows ──

  const phone = use_phone();
  const line_height = props.virtual ? (phone ? props.virtual.card_height : props.virtual.row_height) : undefined;
  const wrap = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  const [view, set_view] = useState({ top: 0, height: 0 });
  const rows_focused = useRef(false);
  const measure = () => {
    const element = wrap.current;
    if (element) set_view({ top: element.scrollTop, height: element.clientHeight });
  };

  useEffect(() => {
    if (line_height === undefined || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap.current!);
    return () => observer.disconnect();
  }, [line_height === undefined]);

  const head_height = head.current?.offsetHeight ?? 0;
  const viewport = view.height || window.innerHeight;
  const windowed = line_height === undefined ? undefined : virtual_window(lines.length, line_height, view.top - head_height, Math.max(line_height, viewport - head_height), props.virtual!.overscan);
  const active_index = props.active_row === undefined ? -1 : lines.findIndex((line) => line.kind === "row" && line.key === String(props.active_row));

  // A row that moves the active row by key hands focus on to it once it is drawn.
  const focus_pending = useRef(false);
  useLayoutEffect(() => { focus_pending.current = line_height !== undefined && rows_focused.current; }, [props.active_row]);

  // The active row scrolls into view as the keys move it.
  useLayoutEffect(() => {
    if (line_height === undefined || active_index < 0) return;
    const element = wrap.current!;
    const row_top = head_height + active_index * line_height;
    const top = view.top;
    const next = row_top < top + head_height ? row_top - head_height : row_top + line_height > top + viewport ? row_top + line_height - viewport : top;
    if (next !== top) {
      element.scrollTop = next;
      set_view({ top: next, height: view.height });
    }
  }, [props.active_row, active_index, line_height]);

  useLayoutEffect(() => {
    if (!focus_pending.current || props.active_row === undefined) return;
    const active = String(props.active_row);
    const row = [...wrap.current!.querySelectorAll<HTMLElement>("tr[data-row-key]")].find((each) => each.dataset.rowKey === active);
    if (!row) return;
    focus_pending.current = false;
    const focused = document.activeElement;
    if (focused !== row && (focused === null || focused === document.body || wrap.current!.contains(focused))) row.focus({ preventScroll: true });
  });

  function spacer(height: number, key: string) {
    if (height <= 0) return null;
    return <tr key={key} className="virtual-spacer" aria-hidden="true" style={{ height }}><td colSpan={shown.length} style={{ padding: 0, border: "none" }} /></tr>;
  }

  function draw_line(line: Line<Row>) {
    if (line.kind === "row") return body_row(line.row, line.key);
    const group = line.group;
    return (
      <tr key={`group ${group.key}`} className={group.class_name ? `group-row ${group.class_name}` : "group-row"}>
        <th scope="colgroup" colSpan={shown.length}>{group.label}</th>
      </tr>
    );
  }

  const drawn = windowed ? lines.slice(windowed.start, windowed.end) : lines;
  const fills_by_fixed = fill_last && shown.slice(0, -1).every((column) => width_of(column) !== undefined);

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
      <div
        ref={wrap}
        className={props.virtual ? "table-wrap virtual" : "table-wrap"}
        style={props.virtual ? { overflowY: "auto" } : undefined}
        onScroll={line_height === undefined ? undefined : measure}
      >
        <table className={fill_last ? "responsive fill-last-column" : "responsive"} style={fills_by_fixed ? { tableLayout: "fixed" } : undefined}>
          {caption && <caption className="visually-hidden">{caption}</caption>}
          <thead ref={head} onContextMenu={props.on_hidden_columns_change && open_columns_menu}><tr>{shown.map(header)}</tr></thead>
          <tbody
            onFocus={() => { rows_focused.current = true; }}
            onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) rows_focused.current = false; }}
          >
            {windowed && spacer(windowed.offset_px, "spacer before")}
            {drawn.map(draw_line)}
            {windowed && spacer(windowed.total_px - windowed.end * line_height!, "spacer after")}
          </tbody>
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
