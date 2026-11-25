// A grid of cards the reader arranges: each card is dragged by its handle or moved with the arrow keys on it, and
// resized from its corner or with Shift and the arrow keys; cards float up to fill the gaps, and a phone shows them in
// a column in the same order. Built on react-grid-layout (MIT), chosen over Gridstack because it is React through and
// through, keeps the layout as plain data the app saves, and covers dragging, resizing and compacting feature by
// feature; X-Libs adds the keyboard path, the phone layout, placing new cards and Halon's markup.

import { type KeyboardEvent, type ReactNode } from "react";
import ReactGridLayout, { moveElement, useContainerWidth, verticalCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import { DragIcon, Icon } from "./icons.tsx";
import { use_phone } from "./phone.ts";

// ── Places ───────────────────────────────────────────────────────────────────

// Where a card sits, in grid cells: its column and row from the top left, its width and its height.
export interface CardPlace {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardSize {
  w: number;
  h: number;
}

function as_layout(places: CardPlace[]): LayoutItem[] {
  return places.map(({ id, x, y, w, h }) => ({ i: id, x, y, w, h }));
}

function as_places(layout: Layout): CardPlace[] {
  return layout.map(({ i, x, y, w, h }) => ({ id: i, x, y, w, h }));
}

// Cards in reading order: by row, then column.
function by_reading_order(first: CardPlace, second: CardPlace): number {
  return first.y - second.y || first.x - second.x;
}

// Every card's place: the saved ones kept within the columns, cards without one added in rows below them, and all of
// them floated up to fill the gaps; places of cards no longer given are dropped.
export function place_cards(ids: string[], saved: CardPlace[], columns: number, default_size: CardSize): CardPlace[] {
  const wanted = new Set(ids);
  const kept = saved
    .filter((place) => wanted.has(place.id))
    .map((place) => {
      const w = Math.max(1, Math.min(Math.round(place.w), columns));
      return { id: place.id, w, h: Math.max(1, Math.round(place.h)), x: Math.max(0, Math.min(Math.round(place.x), columns - w)), y: Math.max(0, Math.round(place.y)) };
    });
  const placed = new Set(kept.map((place) => place.id));
  const w = Math.max(1, Math.min(default_size.w, columns));
  const per_row = Math.max(1, Math.floor(columns / w));
  const bottom = kept.reduce((lowest, place) => Math.max(lowest, place.y + place.h), 0);
  const added = ids
    .filter((id) => !placed.has(id))
    .map((id, index) => ({ id, w, h: default_size.h, x: (index % per_row) * w, y: bottom + Math.floor(index / per_row) * default_size.h }));
  return as_places(verticalCompactor.compact(as_layout([...kept, ...added]), columns)).sort(by_reading_order);
}

export interface CardStep {
  // Cells to move by, across and down.
  x?: number;
  y?: number;
  // Cells to grow by, wider and taller.
  w?: number;
  h?: number;
}

// The places after one card moves or grows by a step, others moving out of its way and everything floating up.
export function step_card(places: CardPlace[], id: string, step: CardStep, columns: number, min_size: CardSize): CardPlace[] {
  const layout = as_layout(places);
  const card = layout.find((item) => item.i === id);
  if (!card) return places;
  let next: Layout;
  if (step.w || step.h) {
    const w = Math.max(min_size.w, Math.min(card.w + (step.w ?? 0), columns - card.x));
    const h = Math.max(min_size.h, card.h + (step.h ?? 0));
    next = layout.map((item) => (item.i === id ? { ...item, w, h } : item));
  } else {
    const x = Math.max(0, Math.min(card.x + (step.x ?? 0), columns - card.w));
    // Moving up a row needs to jump the card above, which floating up would otherwise undo.
    const above = (step.y ?? 0) < 0 ? layout.filter((item) => item.i !== id && item.y + item.h <= card.y && item.x < card.x + card.w && card.x < item.x + item.w) : [];
    const y = above.length ? Math.max(...above.map((item) => item.y)) : Math.max(0, card.y + (step.y ?? 0) * (step.y && step.y > 0 ? card.h : 1));
    next = moveElement(layout, card, x, y, true, false, "vertical", columns);
  }
  return as_places(verticalCompactor.compact(next, columns)).sort(by_reading_order);
}

// What an arrow key does to a card: move it, or with Shift grow or shrink it.
export function step_of_key(key: string, shift: boolean): CardStep | null {
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!delta) return null;
  const [across, down] = delta as [number, number];
  return shift ? { w: across, h: down } : { x: across, y: down };
}

// ── Grid ─────────────────────────────────────────────────────────────────────

interface CardGridProps<Item> {
  items: Item[];
  id_of: (item: Item) => string;
  // A card's plain name, for its handle's label.
  name_of: (item: Item) => string;
  render_card: (item: Item) => ReactNode;
  // The grid's name for screen readers, such as "Items".
  label: string;
  // The places saved; cards without one are placed after them.
  places: CardPlace[];
  // Called once a card has been moved or resized, with every card's place.
  on_places_change: (places: CardPlace[]) => void;
  columns?: number;
  // A row's height in pixels.
  row_height?: number;
  default_size?: CardSize;
  min_size?: CardSize;
  // False shows the cards where they are, with no handles.
  editable?: boolean;
  // A fixed width in pixels instead of the space the grid is given, such as in tests.
  width?: number;
}

const handle_class = "card-grid-handle";

export function CardGrid<Item>({
  items, id_of, name_of, render_card, label, places, on_places_change,
  columns = 12, row_height = 40, default_size = { w: 4, h: 4 }, min_size = { w: 2, h: 2 }, editable = true, width: fixed_width,
}: CardGridProps<Item>) {
  const phone = use_phone();
  const { width: measured, containerRef: container, mounted } = useContainerWidth();
  const width = fixed_width ?? measured;
  const arranged = place_cards(items.map(id_of), places, columns, default_size);
  const by_id = new Map(items.map((item) => [id_of(item), item]));

  const on_key = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const step = step_of_key(event.key, event.shiftKey);
    if (!step) return;
    event.preventDefault();
    on_places_change(step_card(arranged, id, step, columns, min_size));
  };

  if (phone) {
    return (
      <ul className="card-grid is-phone" aria-label={label}>
        {arranged.map((place) => (
          <li key={place.id} className="card-grid-item">
            <div className="card-grid-body">{render_card(by_id.get(place.id)!)}</div>
          </li>
        ))}
      </ul>
    );
  }

  const changed = (layout: Layout) => on_places_change(as_places(layout).sort(by_reading_order));
  return (
    <div ref={container} className="card-grid" role="list" aria-label={label}>
      {(mounted || fixed_width !== undefined) && (
        <ReactGridLayout
          width={width}
          layout={as_layout(arranged).map((item) => ({ ...item, minW: min_size.w, minH: min_size.h }))}
          gridConfig={{ cols: columns, rowHeight: row_height }}
          dragConfig={{ enabled: editable, handle: `.${handle_class}` }}
          resizeConfig={{ enabled: editable, handles: ["se"] }}
          compactor={verticalCompactor}
          onDragStop={changed}
          onResizeStop={changed}
        >
          {arranged.map((place) => {
            const item = by_id.get(place.id)!;
            const name = name_of(item);
            return (
              <div key={place.id} className="card-grid-item" role="listitem">
                {editable && (
                  <button
                    type="button"
                    className={handle_class}
                    aria-label={`Move ${name}`}
                    title="Drag to move, or use the arrow keys; Shift and the arrows resize"
                    onKeyDown={(event) => on_key(event, place.id)}
                  >
                    <Icon icon={DragIcon} />
                  </button>
                )}
                <div className="card-grid-body">{render_card(item)}</div>
              </div>
            );
          })}
        </ReactGridLayout>
      )}
    </div>
  );
}
