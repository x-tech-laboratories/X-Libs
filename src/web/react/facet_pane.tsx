// A facet pane: the values of one field with how many items hold each, picked one or several at a time to narrow a list.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { plural } from "../format.ts";
import { row_after_key, still_shown, toggled, with_range } from "../selection.ts";
import { virtual_window } from "../virtual.ts";
import { Empty, Failure, Skeleton } from "./states.tsx";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FacetValue {
  // The value as the app filters by it.
  value: string;
  count: number;
  // What the row shows, the value itself unless given, such as a Rating for a rating.
  label?: ReactNode;
}

export interface FacetPaneLabels {
  all: string;
  empty: string;
  // The line beside the heading, such as "12 values" or "2 of 12 picked".
  summary: (picked: number, values: number) => string;
}

const DEFAULT_LABELS: FacetPaneLabels = {
  all: "All",
  empty: "No values",
  summary: (picked, values) => (picked > 1 ? `${picked.toLocaleString()} of ${values.toLocaleString()} picked` : plural(values, "value")),
};

interface FacetPaneProps {
  // The pane's name for screen readers, such as "Genre", so several panes on a page tell apart.
  label: string;
  values: FacetValue[];
  selected: readonly string[];
  on_change: (selected: string[]) => void;
  // Shown above the list, such as a select that chooses the field.
  heading?: ReactNode;
  // False picks one value at a time.
  multiple?: boolean;
  // The All row's count, the sum of the values' counts unless given, since an item can hold several values.
  total?: number;
  // Shows a skeleton while there are no values yet.
  loading?: boolean;
  // Shows the failure with Retry in place of the list while there are no values.
  error?: unknown;
  on_retry?: () => void;
  // Draws only the rows in view, for long lists such as every artist; the row height is in pixels.
  virtual?: { row_height: number; overscan?: number };
  labels?: Partial<FacetPaneLabels>;
}

// ── Picking ──────────────────────────────────────────────────────────────────

interface Modifiers {
  shift: boolean;
  ctrl: boolean;
}

// The values picked after a click or key on one value, the anchor fixed by the last plain or Ctrl pick.
export function facet_pick(order: readonly string[], selected: readonly string[], anchor: string | null, value: string, modifiers: Modifiers, multiple = true): string[] {
  if (multiple && modifiers.shift) return still_shown(order, with_range(order, modifiers.ctrl ? selected : [], anchor ?? value, value));
  if (multiple && modifiers.ctrl) return still_shown(order, toggled(selected, value));
  // A plain pick of the only value picked clears it, so the row works as a toggle.
  return selected.length === 1 && selected[0] === value ? [] : [value];
}

const modifiers_of = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): Modifiers => ({ shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey });

// ── Pane ─────────────────────────────────────────────────────────────────────

export function FacetPane({
  label, values, selected, on_change, heading, multiple = true, total, loading = false, error, on_retry, virtual, labels: own_labels,
}: FacetPaneProps) {
  const labels = { ...DEFAULT_LABELS, ...own_labels };
  const order = values.map((each) => each.value);
  const picked = new Set(selected);
  const line_count = values.length + 1;
  const all_count = total ?? values.reduce((sum, each) => sum + each.count, 0);

  const anchor = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const options = useRef(new Map<number, HTMLLIElement>());
  const focus_pending = useRef(false);
  const [focused, set_focused] = useState<number | null>(null);
  const [view, set_view] = useState({ top: 0, height: 0 });

  const first_picked = values.findIndex((each) => picked.has(each.value));
  const tab_stop = focused !== null && focused < line_count ? focused : first_picked + 1;

  // ── Virtual rows ──

  const row_height = virtual?.row_height;
  const measure = () => {
    const element = scroller.current;
    if (element) set_view({ top: element.scrollTop, height: element.clientHeight });
  };

  useEffect(() => {
    if (row_height === undefined || typeof ResizeObserver === "undefined" || !scroller.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [row_height === undefined, values.length > 0]);

  const viewport = view.height || window.innerHeight;
  const windowed = row_height === undefined
    ? { start: 0, end: line_count, offset_px: 0, total_px: 0 }
    : virtual_window(line_count, row_height, view.top, viewport, virtual!.overscan);
  const rows_per_page = row_height === undefined ? 10 : Math.max(1, Math.floor(viewport / row_height));

  // Brings a row into the drawn window before focus moves to it.
  function scroll_to(index: number): void {
    const element = scroller.current;
    if (row_height === undefined || !element) return;
    const row_top = index * row_height;
    const next = row_top < view.top ? row_top : row_top + row_height > view.top + viewport ? row_top + row_height - viewport : view.top;
    if (next === view.top) return;
    element.scrollTop = next;
    set_view({ top: next, height: view.height });
  }

  function move_focus(index: number): void {
    scroll_to(index);
    focus_pending.current = true;
    set_focused(index);
  }

  useLayoutEffect(() => {
    if (!focus_pending.current || focused === null) return;
    const option = options.current.get(focused);
    if (!option) return;
    focus_pending.current = false;
    option.focus({ preventScroll: row_height !== undefined });
  });

  // ── Picks ──

  function pick_all(): void {
    anchor.current = null;
    if (selected.length > 0) on_change([]);
  }

  function pick(index: number, modifiers: Modifiers): void {
    if (index === 0) return pick_all();
    const value = order[index - 1]!;
    const next = facet_pick(order, selected, anchor.current, value, modifiers, multiple);
    if (!(multiple && modifiers.shift)) anchor.current = value;
    else anchor.current ??= value;
    on_change(next);
  }

  function click(index: number, event: MouseEvent<HTMLLIElement>): void {
    set_focused(index);
    pick(index, modifiers_of(event));
  }

  function key_down(event: KeyboardEvent<HTMLUListElement>): void {
    const current = focused ?? tab_stop;
    const modifiers = modifiers_of(event);
    const next = row_after_key(event.key, current, line_count - 1, rows_per_page);
    if (next !== null) {
      event.preventDefault();
      move_focus(next);
      // Shift with a move stretches the picks from the anchor, as a Shift click does.
      if (multiple && modifiers.shift && next > 0) {
        anchor.current ??= current > 0 ? order[current - 1]! : order[next - 1]!;
        on_change(facet_pick(order, selected, anchor.current, order[next - 1]!, modifiers, multiple));
      }
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      pick(current, { shift: false, ctrl: modifiers.ctrl });
    } else if (event.key === "Escape" && selected.length > 0) {
      event.preventDefault();
      pick_all();
    } else if (multiple && modifiers.ctrl && event.key.toLowerCase() === "a") {
      event.preventDefault();
      on_change([...order]);
    }
  }

  // ── Drawing ──

  function option(index: number) {
    const facet = index === 0 ? null : values[index - 1]!;
    const is_selected = facet === null ? selected.length === 0 : picked.has(facet.value);
    return (
      <li
        key={facet === null ? "all" : `value ${facet.value}`}
        ref={(element) => { if (element) options.current.set(index, element); else options.current.delete(index); }}
        role="option"
        className="tree-item"
        aria-selected={is_selected}
        aria-setsize={row_height === undefined ? undefined : line_count}
        aria-posinset={row_height === undefined ? undefined : index + 1}
        tabIndex={index === tab_stop ? 0 : -1}
        style={row_height === undefined ? undefined : { height: row_height }}
        onClick={(event) => click(index, event)}
        onFocus={() => set_focused(index)}
      >
        <div className="tree-row">
          <span className="tree-label">{facet === null ? labels.all : (facet.label ?? facet.value)}</span>
          <span className="tree-extra">{(facet === null ? all_count : facet.count).toLocaleString()}</span>
        </div>
      </li>
    );
  }

  function spacer(height: number, key: string) {
    if (height <= 0) return null;
    return <li key={key} role="presentation" aria-hidden="true" style={{ height }} />;
  }

  let body: ReactNode;
  if (values.length === 0 && error !== undefined && error !== null) body = <Failure error={error} retry={() => on_retry?.()} />;
  else if (values.length === 0 && loading) body = <Skeleton />;
  else if (values.length === 0) body = <Empty title={labels.empty} />;
  else {
    const drawn = Array.from({ length: windowed.end - windowed.start }, (_, offset) => option(windowed.start + offset));
    body = (
      <ul role="listbox" className="tree" aria-label={label} aria-multiselectable={multiple || undefined} onKeyDown={key_down}>
        {row_height !== undefined && spacer(windowed.offset_px, "before")}
        {drawn}
        {row_height !== undefined && spacer(windowed.total_px - windowed.offset_px - drawn.length * row_height, "after")}
      </ul>
    );
  }

  return (
    <section className="facet-pane" aria-label={label} style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", minHeight: 0, height: "100%" }}>
      <div className="panel-head">
        {heading}
        {values.length > 0 && <span className="muted small">{labels.summary(selected.length, values.length)}</span>}
      </div>
      <div ref={scroller} style={{ minHeight: 0, overflowY: "auto" }} onScroll={row_height === undefined ? undefined : measure}>
        {body}
      </div>
    </section>
  );
}
