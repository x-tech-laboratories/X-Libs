// A board: a column per step and, optionally, a lane per thing moving through them, each lane with its head and the
// lanes grouped under headings that fold. A cell per lane and column holds the app's content or its cards; the board
// is worked by keyboard as a grid, cards move between columns by dragging or with Alt and the arrow keys, and phones
// get a list of lanes, each showing its cells under their column names, or the columns one under another, whose cards
// move the same way.

import {
  useEffect, useRef, useState,
  type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode,
} from "react";
import { cx } from "../dom.ts";
import { format_count } from "../format.ts";
import { group_items } from "../../grouping.ts";
import { ChevronDownIcon, ChevronRightIcon, Icon } from "./icons.tsx";
import { use_phone } from "./phone.ts";
import { Empty, Failure, Skeleton } from "./states.tsx";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BoardColumn {
  id: string;
  label: string;
  // A number beside the label, such as how many cards the column holds.
  count?: number;
  // What the head shows after the label and count, such as a menu button.
  extra?: ReactNode;
  // The head's hover text, such as what the column means.
  title?: string;
  // A class for the head, such as Halon's tone-bad for a column of late work.
  class_name?: string;
  // False refuses cards dragged or moved into the column.
  accepts_drop?: boolean;
}

export interface BoardLane {
  id: string;
  // The lane's plain name, for screen readers and a folded group's count.
  label: string;
  // What the lane's head shows, its label unless given.
  head?: ReactNode;
  // The group the lane is listed under, from the lanes' groups in `group_items` order.
  group?: string | null;
  // The id of the column the lane is at, which is outlined.
  current?: string | null;
}

// Where a card moves: from one column to another in the same lane, null on a board without lanes.
export interface BoardMove<Column extends BoardColumn, Lane extends BoardLane> {
  lane: Lane | null;
  from: Column;
  to: Column;
}

export interface BoardCards<Card, Column extends BoardColumn, Lane extends BoardLane> {
  // The cards in one cell, in the order shown.
  of: (lane: Lane | null, column: Column) => readonly Card[];
  id: (card: Card) => string;
  render: (card: Card, lane: Lane | null, column: Column) => ReactNode;
  class_name?: (card: Card) => string | undefined;
  style?: (card: Card) => CSSProperties | undefined;
  // Called on a click or Enter, such as to select or open the card.
  on_open?: (card: Card, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, lane: Lane | null, column: Column) => void;
  on_context_menu?: (card: Card, event: MouseEvent<HTMLElement>) => void;
  // Called as a drag starts, such as to drag the other picked cards along or set a drag badge.
  on_drag_start?: (card: Card, event: DragEvent<HTMLElement>) => void;
  on_drag_end?: (card: Card) => void;
}

export interface BoardLabels {
  // What an empty board says.
  empty: string;
  // The heading over lanes that have no group.
  no_group: string;
}

const DEFAULT_LABELS: BoardLabels = { empty: "Nothing here", no_group: "Other" };

interface BoardProps<Card, Column extends BoardColumn, Lane extends BoardLane> {
  // The board's name for screen readers, such as "Board".
  label: string;
  columns: readonly Column[];
  // Without lanes the board is a plain one, a single row of columns.
  lanes?: readonly Lane[];
  // The heading over the lane heads, such as "Item".
  lane_heading?: ReactNode;
  // Each column's width as CSS, Halon's 280px unless given.
  column_width?: string;
  // The lane heads' width as CSS, Halon's 240px unless given.
  lane_width?: string;
  // Group keys that come first in this order; the rest follow by name.
  group_order?: readonly string[];
  // A group's heading from its key, null being the lanes with none.
  group_label?: (key: string | null) => ReactNode;
  // The keys of folded groups, "" for the lanes with none; the board keeps them itself unless given.
  folded_groups?: ReadonlySet<string>;
  on_folded_groups_change?: (folded: Set<string>) => void;
  // A cell's content, when the board shows no cards.
  render_cell?: (lane: Lane | null, column: Column) => ReactNode;
  // The cards in each cell, which take focus, open, and move between columns.
  cards?: BoardCards<Card, Column, Lane>;
  // Called when a card is dropped on another column or moved with Alt and an arrow; the board redraws once the cards change.
  on_move?: (card: Card, move: BoardMove<Column, Lane>) => void;
  // Refuses a move the app does not allow, such as a card into a column it cannot enter; a refused cell is never lit as a drop target.
  can_move?: (card: Card, move: BoardMove<Column, Lane>) => boolean;
  // Called on Enter in a cell, or on a lane's head with a null column.
  on_open?: (lane: Lane | null, column: Column | null) => void;
  // Shows a skeleton in place of an empty board.
  loading?: boolean;
  // Shows the failure with Retry in place of an empty board.
  error?: unknown;
  on_retry?: () => void;
  // What an empty board shows in place of the empty label.
  empty?: ReactNode;
  // Leaves out a plain board's columns that hold nothing on phones; a board with lanes always leaves out its empty cells.
  phone_hide_empty?: boolean;
  // A class for the board's box, such as Halon's fills to take the height left in a contained page, or inset for a margin inside.
  class_name?: string;
  labels?: Partial<BoardLabels>;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

type BoardRow<Lane> = { kind: "group"; key: string; name: ReactNode; count: number; folded: boolean } | { kind: "lane"; lane: Lane | null };

// Where focus can rest in a row: the lane's head, then each column's cards or the cell itself.
interface RowTargets {
  head: string | null;
  cells: string[][];
}

interface Spot {
  row: number;
  column: number;
  card: number;
}

const separator = "\u0000";
const group_target = (key: string) => `group${separator}${key}`;
const head_target = (lane_id: string) => `head${separator}${lane_id}`;
const cell_target = (lane_id: string, column_id: string) => `cell${separator}${lane_id}${separator}${column_id}`;
const card_target = (lane_id: string, column_id: string, card_id: string) => `card${separator}${lane_id}${separator}${column_id}${separator}${card_id}`;

// The browser pictures a dragged card as its drag starts, so the card lifts for that moment and fades only afterwards.
function lift_for_picture(card: HTMLElement, after: () => void): void {
  card.classList.add("drag-preview");
  setTimeout(() => {
    card.classList.remove("drag-preview");
    after();
  });
}

// The column a card moves by with Alt and an arrow on a phone, where the columns stack.
const phone_steps: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

// Content that draws nothing, which a phone leaves out.
const is_blank = (content: ReactNode) => content === null || content === undefined || content === false || content === "";

// ── Board ────────────────────────────────────────────────────────────────────

export function Board<Card, Column extends BoardColumn, Lane extends BoardLane = BoardLane>({
  label, columns, lanes, lane_heading, column_width, lane_width, group_order, group_label, folded_groups, on_folded_groups_change, render_cell, cards,
  on_move, can_move, on_open, loading = false, error, on_retry, empty, phone_hide_empty = false, class_name, labels: own_labels,
}: BoardProps<Card, Column, Lane>) {
  const labels = { ...DEFAULT_LABELS, ...own_labels };
  const phone = use_phone();
  const has_lanes = lanes !== undefined;

  const [own_folded, set_own_folded] = useState<ReadonlySet<string>>(() => new Set());
  const folded = folded_groups ?? own_folded;
  const [focused, set_focused] = useState<string | null>(null);
  const [dragged, set_dragged] = useState<{ card: Card; lane_id: string; column_id: string; target: string } | null>(null);
  const [drop_cell, set_drop_cell] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const focus_pending = useRef(false);
  const last_column = useRef(-1);
  const drag_under_way = useRef(false);

  useEffect(() => {
    if (!focus_pending.current || focused === null) return;
    const element = elements.current.get(focused);
    if (!element) return;
    focus_pending.current = false;
    element.focus();
  });

  // ── Lanes and groups ──

  const lane_list: (Lane | null)[] = has_lanes ? [...lanes] : [null];
  const is_grouped = has_lanes && lanes.some((lane) => lane.group !== undefined && lane.group !== null && lane.group !== "");
  const rows: BoardRow<Lane>[] = !is_grouped
    ? lane_list.map((lane) => ({ kind: "lane", lane }))
    : group_items(lanes!, (lane) => lane.group, { order: group_order }).flatMap((group): BoardRow<Lane>[] => {
      const key = group.key ?? "";
      const is_folded = folded.has(key);
      const heading: BoardRow<Lane> = { kind: "group", key, name: group_label?.(group.key) ?? group.key ?? labels.no_group, count: group.items.length, folded: is_folded };
      return [heading, ...(is_folded ? [] : group.items.map((lane): BoardRow<Lane> => ({ kind: "lane", lane })))];
    });

  function set_folded(key: string, is_folded: boolean): void {
    if (folded.has(key) === is_folded) return;
    const next = new Set(folded);
    if (is_folded) next.add(key);
    else next.delete(key);
    if (!folded_groups) set_own_folded(next);
    on_folded_groups_change?.(next);
  }

  const lane_id = (lane: Lane | null) => lane?.id ?? "";
  const cards_in = (lane: Lane | null, column: Column) => cards?.of(lane, column) ?? [];

  // ── Focus targets ──

  const targets: RowTargets[] = rows.map((row) => {
    if (row.kind === "group") return { head: null, cells: [[group_target(row.key)]] };
    const id = lane_id(row.lane);
    return {
      head: has_lanes ? head_target(id) : null,
      cells: columns.map((column) => {
        const shown = cards_in(row.lane, column);
        return shown.length > 0 && cards ? shown.map((card) => card_target(id, column.id, cards.id(card))) : [cell_target(id, column.id)];
      }),
    };
  });

  const spots = new Map<string, Spot>();
  targets.forEach((row, row_index) => {
    if (row.head) spots.set(row.head, { row: row_index, column: -1, card: 0 });
    row.cells.forEach((cell, column) => cell.forEach((key, card) => spots.set(key, { row: row_index, column, card })));
  });
  const first_target = targets[0] ? (targets[0].head ?? targets[0].cells[0]?.[0] ?? null) : null;
  const tab_stop = focused !== null && spots.has(focused) ? focused : first_target;

  function register(key: string) {
    return (element: HTMLElement | null) => {
      if (element) elements.current.set(key, element);
      else elements.current.delete(key);
    };
  }

  function focus_target(key: string | null | undefined): void {
    if (!key) return;
    focus_pending.current = true;
    set_focused(key);
  }

  // The target in a row nearest the given column and card, the head being column -1.
  function target_at(row_index: number, column: number, card: number): string | undefined {
    const row = targets[row_index];
    if (!row) return undefined;
    if (rows[row_index]!.kind === "group") return row.cells[0]![0];
    if (column < 0 && row.head) return row.head;
    const cell = row.cells[Math.min(Math.max(column, 0), row.cells.length - 1)];
    return cell?.[Math.min(card, cell.length - 1)];
  }

  // ── Moving cards ──

  // Whether a card may go from one column to another, by the target column and then by the app.
  function allows(card: Card, lane: Lane | null, from_id: string, to: Column): boolean {
    const from = columns.find((column) => column.id === from_id);
    return Boolean(on_move) && from !== undefined && from.id !== to.id && to.accepts_drop !== false && (can_move?.(card, { lane, from, to }) ?? true);
  }

  function move_card(card: Card, lane: Lane | null, from_id: string, to: Column): void {
    if (!allows(card, lane, from_id, to)) return;
    on_move!(card, { lane, from: columns.find((column) => column.id === from_id)!, to });
  }

  // Moves a card to the nearest column that takes it in the given direction and keeps focus on it.
  function step_card(card: Card, lane: Lane | null, from: Column, step: number): void {
    let index = columns.indexOf(from) + step;
    while (columns[index] && !allows(card, lane, from.id, columns[index]!)) index += step;
    const to = columns[index];
    if (!to) return;
    move_card(card, lane, from.id, to);
    focus_target(card_target(lane_id(lane), to.id, cards!.id(card)));
  }

  function can_drop_on(lane: Lane | null, column: Column): boolean {
    return dragged !== null && dragged.lane_id === lane_id(lane) && allows(dragged.card, lane, dragged.column_id, column);
  }

  function end_drag(): void {
    drag_under_way.current = false;
    set_dragged(null);
    set_drop_cell(null);
  }

  // What makes a cell, or a phone's column or cell, take a dragged card.
  function drop_target(lane: Lane | null, column: Column) {
    const drop_key = cell_target(lane_id(lane), column.id);
    return {
      is_lit: drop_cell === drop_key,
      handlers: {
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (!can_drop_on(lane, column)) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          if (drop_cell !== drop_key) set_drop_cell(drop_key);
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) set_drop_cell(null);
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          const was = dragged;
          const allowed = can_drop_on(lane, column);
          end_drag();
          if (!was || !allowed) return;
          event.preventDefault();
          move_card(was.card, lane, was.column_id, column);
        },
      },
    };
  }

  // ── Keyboard ──

  function key_down(event: KeyboardEvent<HTMLElement>): void {
    const key = (event.target as HTMLElement).dataset.boardTarget;
    const spot = key === undefined ? undefined : spots.get(key);
    if (key === undefined || !spot) return;
    const row = rows[spot.row]!;
    const cell_count = targets[spot.row]!.cells[spot.column]?.length ?? 1;
    const ctrl = event.ctrlKey || event.metaKey;

    if (row.kind === "group") {
      if (event.key === "Enter" || event.key === " ") set_folded(row.key, !row.folded);
      else if (event.key === "ArrowRight" && row.folded) set_folded(row.key, false);
      else if (event.key === "ArrowLeft" && !row.folded) set_folded(row.key, true);
      else if (event.key === "ArrowDown") focus_target(target_at(spot.row + 1, last_column.current, 0));
      else if (event.key === "ArrowUp") focus_target(target_at(spot.row - 1, last_column.current, Infinity));
      else if (event.key === "Home" && ctrl) focus_target(first_target);
      else if (event.key === "End" && ctrl) focus_target(target_at(rows.length - 1, columns.length - 1, 0));
      else return;
      event.preventDefault();
      return;
    }

    const lane = row.lane;
    const column = columns[spot.column];
    const first_column = has_lanes ? -1 : 0;
    last_column.current = spot.column;

    if (event.altKey && key.startsWith("card") && on_move && column && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      step_card(cards_in(lane, column)[spot.card]!, lane, column, event.key === "ArrowRight" ? 1 : -1);
    } else if (event.altKey) {
      return;
    } else if (event.key === "ArrowDown") {
      if (spot.column >= 0 && spot.card < cell_count - 1) focus_target(target_at(spot.row, spot.column, spot.card + 1));
      else focus_target(target_at(spot.row + 1, spot.column, 0));
    } else if (event.key === "ArrowUp") {
      if (spot.column >= 0 && spot.card > 0) focus_target(target_at(spot.row, spot.column, spot.card - 1));
      else focus_target(target_at(spot.row - 1, spot.column, Infinity));
    } else if (event.key === "ArrowRight") {
      if (spot.column < columns.length - 1) focus_target(target_at(spot.row, spot.column + 1, spot.card));
    } else if (event.key === "ArrowLeft") {
      if (spot.column > first_column) focus_target(target_at(spot.row, spot.column - 1, spot.card));
    } else if (event.key === "Home") {
      focus_target(ctrl ? first_target : target_at(spot.row, first_column, 0));
    } else if (event.key === "End") {
      focus_target(target_at(ctrl ? rows.length - 1 : spot.row, columns.length - 1, 0));
    } else if (event.key === "Enter") {
      if (key.startsWith("card") && column) cards?.on_open?.(cards_in(lane, column)[spot.card]!, event, lane, column);
      else on_open?.(lane, column ?? null);
    } else {
      return;
    }
    event.preventDefault();
  }

  // ── Drawing ──

  function card_list(lane: Lane | null, column: Column, shown: readonly Card[], in_grid: boolean) {
    if (!cards || shown.length === 0) return null;
    const id = lane_id(lane);
    return (
      <ul className="board-cards">
        {shown.map((card) => {
          const target = card_target(id, column.id, cards.id(card));
          return (
            <li
              key={cards.id(card)}
              ref={register(target)}
              data-board-target={in_grid ? target : undefined}
              className={cx("board-card", cards.class_name?.(card), dragged?.target === target && "dragging")}
              style={cards.style?.(card)}
              tabIndex={in_grid ? (tab_stop === target ? 0 : -1) : 0}
              draggable={on_move ? true : undefined}
              onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); }}
              onClick={(event) => cards.on_open?.(card, event, lane, column)}
              onContextMenu={cards.on_context_menu && ((event) => cards.on_context_menu!(card, event))}
              onKeyDown={in_grid ? undefined : (event) => {
                if (event.target !== event.currentTarget) return;
                const step = phone_steps[event.key];
                if (event.altKey && step !== undefined && on_move) {
                  event.preventDefault();
                  step_card(card, lane, column, step);
                } else if (event.key === "Enter" && !event.altKey) {
                  event.preventDefault();
                  cards.on_open?.(card, event, lane, column);
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer?.setData("text/plain", cards.id(card));
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                drag_under_way.current = true;
                lift_for_picture(event.currentTarget, () => { if (drag_under_way.current) set_dragged({ card, lane_id: id, column_id: column.id, target }); });
                cards.on_drag_start?.(card, event);
              }}
              onDragEnd={() => {
                end_drag();
                cards.on_drag_end?.(card);
              }}
            >
              {cards.render(card, lane, column)}
            </li>
          );
        })}
      </ul>
    );
  }

  function column_head(column: Column) {
    return (
      <>
        <span className="board-column-label">{column.label}</span>
        {column.count !== undefined && <span className="group-count">{format_count(column.count)}</span>}
        {column.extra}
      </>
    );
  }

  function grid_cell(lane: Lane | null, column: Column) {
    const id = lane_id(lane);
    const shown = cards_in(lane, column);
    const own_target = shown.length > 0 && cards ? null : cell_target(id, column.id);
    const drop = drop_target(lane, column);
    const is_current = lane?.current === column.id;
    return (
      <div
        key={column.id}
        ref={own_target ? register(own_target) : undefined}
        role="gridcell"
        data-board-target={own_target ?? undefined}
        className={cx("board-cell", is_current && "current", drop.is_lit && "drop-inside")}
        aria-current={is_current || undefined}
        tabIndex={own_target ? (tab_stop === own_target ? 0 : -1) : undefined}
        {...drop.handlers}
      >
        {cards ? card_list(lane, column, shown, true) : render_cell?.(lane, column)}
      </div>
    );
  }

  function group_toggle(row: Extract<BoardRow<Lane>, { kind: "group" }>, in_grid: boolean) {
    const target = group_target(row.key);
    return (
      <button
        type="button"
        ref={in_grid ? register(target) : undefined}
        data-board-target={in_grid ? target : undefined}
        className="board-group-toggle"
        aria-expanded={!row.folded}
        tabIndex={in_grid ? (tab_stop === target ? 0 : -1) : undefined}
        onClick={() => set_folded(row.key, !row.folded)}
      >
        <Icon icon={row.folded ? ChevronRightIcon : ChevronDownIcon} />
        <span className="board-group-name">{row.name}</span>
        <span className="group-count">{format_count(row.count)}</span>
      </button>
    );
  }

  // ── States ──

  if (columns.length === 0 || (has_lanes && lanes.length === 0)) {
    if (error !== undefined && error !== null) return <Failure error={error} retry={() => on_retry?.()} />;
    if (loading) return <Skeleton />;
    return <>{empty ?? <Empty title={labels.empty} />}</>;
  }

  // ── Phone ──

  if (phone && !has_lanes) {
    return (
      <div className={cx("board-phone", class_name)} aria-label={label} role="region">
        {columns.map((column) => {
          const content = cards ? card_list(null, column, cards_in(null, column), false) : render_cell?.(null, column);
          if (phone_hide_empty && is_blank(content) && !can_drop_on(null, column)) return null;
          const drop = drop_target(null, column);
          return (
            <section key={column.id} className={cx("board-phone-column", drop.is_lit && "drop-inside")} aria-label={column.label} {...drop.handlers}>
              <h3 className={cx("board-column-head", column.class_name)} title={column.title}>{column_head(column)}</h3>
              {content}
            </section>
          );
        })}
      </div>
    );
  }

  if (phone) {
    return (
      <div className={cx("board-phone", class_name)} aria-label={label} role="region">
        {rows.map((row) => {
          if (row.kind === "group") return <h3 key={`group ${row.key}`} className="board-group-head">{group_toggle(row, false)}</h3>;
          const lane = row.lane!;
          return (
            <section key={lane.id} className="board-lane-card" aria-label={lane.label}>
              <div className="board-lane-head">{lane.head ?? lane.label}</div>
              {columns.map((column) => {
                const is_current = lane.current === column.id;
                const shown = cards_in(lane, column);
                const content = cards ? card_list(lane, column, shown, false) : render_cell?.(lane, column);
                if (is_blank(content) && !is_current && !can_drop_on(lane, column)) return null;
                const drop = drop_target(lane, column);
                return (
                  <div key={column.id} className={cx("board-phone-cell", is_current && "current", drop.is_lit && "drop-inside")} aria-current={is_current || undefined} {...drop.handlers}>
                    <div className={cx("board-cell-label", column.class_name)}>{column.label}</div>
                    {content}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    );
  }

  // ── Grid ──

  return (
    <div className={cx("board", class_name)}>
      <div
        role="grid"
        aria-label={label}
        className={cx("board-grid", has_lanes && "has-lanes")}
        style={{ "--board-columns": columns.length, "--board-column-width": column_width, "--board-lane-width": lane_width } as CSSProperties}
        onKeyDown={key_down}
        onFocus={(event) => {
          const key = (event.target as HTMLElement).dataset.boardTarget;
          if (key !== undefined) set_focused(key);
        }}
      >
        <div role="row" className="board-row board-heads">
          {has_lanes && <div role="columnheader" className="board-corner">{lane_heading}</div>}
          {columns.map((column) => (
            <div key={column.id} role="columnheader" className={cx("board-column-head", column.class_name)} title={column.title}>
              {column_head(column)}
            </div>
          ))}
        </div>
        {rows.map((row) => {
          if (row.kind === "group") {
            return (
              <div key={`group ${row.key}`} role="row" className="board-row board-group">
                <div role="gridcell" className="board-group-head" aria-colspan={columns.length + 1}>{group_toggle(row, true)}</div>
              </div>
            );
          }
          const lane = row.lane;
          const head = lane ? head_target(lane.id) : null;
          return (
            <div key={lane_id(lane)} role="row" className="board-row">
              {lane && head && (
                <div ref={register(head)} role="rowheader" data-board-target={head} className="board-lane-head" tabIndex={tab_stop === head ? 0 : -1}>
                  {lane.head ?? lane.label}
                </div>
              )}
              {columns.map((column) => grid_cell(lane, column))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
