// Resizing panes: the arithmetic of what a drag may do, and the pointer and keyboard handling of a resize handle.

// ── Panes ────────────────────────────────────────────────────────────────────

export interface PaneSpec {
  // Smallest the pane may become, in pixels.
  min?: number;
  // Largest the pane may become, in pixels.
  max?: number;
  // Whether the pane takes up spare space first when the container resizes.
  grow?: boolean;
}

const default_minimum = 40;

// How far one arrow press moves a handle, and how far with Shift held.
export const keyboard_step = 16;
export const keyboard_step_large = 64;

const minimum_of = (spec: PaneSpec | undefined): number => spec?.min ?? default_minimum;
const maximum_of = (spec: PaneSpec | undefined): number => spec?.max ?? Number.POSITIVE_INFINITY;
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

// ── Sizing ───────────────────────────────────────────────────────────────────

// Moves the boundary after pane index by delta pixels, changing only its two neighbours and stopping where either hits a limit.
export function resize_at(sizes: readonly number[], index: number, delta: number, specs: readonly PaneSpec[] = []): number[] {
  const before = sizes[index];
  const after = sizes[index + 1];
  if (before === undefined || after === undefined) return [...sizes];

  const most_growth = Math.min(maximum_of(specs[index]) - before, after - minimum_of(specs[index + 1]));
  const most_shrink = Math.min(before - minimum_of(specs[index]), maximum_of(specs[index + 1]) - after);
  const applied = clamp(delta, -most_shrink, most_growth);

  const next = [...sizes];
  next[index] = before + applied;
  next[index + 1] = after - applied;
  return next;
}

// Fits panes to the container's length, growing panes first and every pane otherwise, never below a pane's minimum.
export function fit(sizes: readonly number[], total: number, specs: readonly PaneSpec[] = []): number[] {
  if (sizes.length === 0) return [];

  const next = [...sizes];
  let difference = total - next.reduce((sum, size) => sum + size, 0);
  if (Math.abs(difference) < 0.5) return next.map(Math.round);

  const growers = next.map((_, index) => index).filter((index) => specs[index]?.grow);
  const targets = growers.length > 0 ? growers : next.map((_, index) => index);

  // A pane that hits its limit hands the rest back to the others, so a few passes share it out.
  for (let pass = 0; pass < 4 && Math.abs(difference) > 0.5; pass += 1) {
    const with_room = targets.filter((index) => difference > 0 ? next[index]! < maximum_of(specs[index]) : next[index]! > minimum_of(specs[index]));
    if (with_room.length === 0) break;
    const share = difference / with_room.length;
    for (const index of with_room) {
      const before = next[index]!;
      next[index] = clamp(before + share, minimum_of(specs[index]), maximum_of(specs[index]));
      difference -= next[index]! - before;
    }
  }
  return next.map(Math.round);
}

// The first sizes for a container: each pane's preferred size or minimum, fitted to the length.
export function distribute(total: number, specs: readonly PaneSpec[], preferred?: readonly (number | undefined)[]): number[] {
  return fit(specs.map((spec, index) => preferred?.[index] ?? spec.min ?? total / specs.length), total, specs);
}

// ── Remembering ──────────────────────────────────────────────────────────────

// The sizes kept under the key, or null when there are none for this many panes.
export function stored_sizes(storage_key: string, count: number): number[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storage_key) ?? "null") as unknown;
    if (!Array.isArray(parsed) || parsed.length !== count) return null;
    return parsed.every((size) => typeof size === "number" && Number.isFinite(size)) ? parsed as number[] : null;
  } catch {
    return null;
  }
}

export function store_sizes(storage_key: string, sizes: readonly number[]): void {
  try {
    localStorage.setItem(storage_key, JSON.stringify(sizes));
  } catch {
    // Without storage the sizes last until the page is closed.
  }
}

// ── Handles ──────────────────────────────────────────────────────────────────

export type Axis = "horizontal" | "vertical";

// Follows a drag that starts on the handle, handing on how far the pointer has moved along the axis.
export function follow_drag(handle: HTMLElement, start: PointerEvent, axis: Axis, on_move: (moved: number) => void, on_end: () => void): void {
  if (start.button !== 0) return;
  start.preventDefault();
  const origin = axis === "horizontal" ? start.clientX : start.clientY;

  const move = (event: PointerEvent) => on_move((axis === "horizontal" ? event.clientX : event.clientY) - origin);
  const stop = () => {
    if (handle.hasPointerCapture(start.pointerId)) handle.releasePointerCapture(start.pointerId);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
    handle.classList.remove("dragging");
    document.body.classList.remove("resizing", "vertical");
    on_end();
  };

  handle.setPointerCapture(start.pointerId);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  handle.classList.add("dragging");
  document.body.classList.add("resizing");
  if (axis === "vertical") document.body.classList.add("vertical");
}

// How far an arrow key moves a handle along the axis, or null for any other key.
export function key_step(event: KeyboardEvent, axis: Axis): number | null {
  const step = event.shiftKey ? keyboard_step_large : keyboard_step;
  const steps: Record<string, number> = axis === "horizontal" ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
  return steps[event.key] ?? null;
}
