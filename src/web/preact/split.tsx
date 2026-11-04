// Preact resize handles: one on a panel's edge, and a split whose panes share a container and remember their sizes.

import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { distribute, fit, follow_drag, key_step, resize_at, store_sizes, stored_sizes, type Axis, type PaneSpec } from "../split.ts";

export type { PaneSpec } from "../split.ts";

// ── Handle ───────────────────────────────────────────────────────────────────

interface ResizeHandleProps {
  // The window edge the resized panel sits against, so dragging away from it grows the panel.
  side: "left" | "right" | "top" | "bottom";
  size: number;
  min: number;
  max: number;
  default_size: number;
  on_resize: (size: number) => void;
  on_resize_end: (size: number) => void;
  label: string;
  // An extra class, such as one that places the handle over a panel's border.
  class_name?: string;
}

// A thin bar on a panel's inner edge: drag it or press the arrow keys to resize, double-click it to reset.
export function ResizeHandle({ side, size, min, max, default_size, on_resize, on_resize_end, label, class_name }: ResizeHandleProps) {
  const axis: Axis = side === "left" || side === "right" ? "horizontal" : "vertical";
  const direction = side === "left" || side === "top" ? 1 : -1;
  const clamp = (value: number): number => Math.round(Math.min(max, Math.max(min, value)));

  function start_drag(event: PointerEvent): void {
    const start_size = size;
    let latest = size;
    follow_drag(event.currentTarget as HTMLElement, event, axis, (moved) => {
      latest = clamp(start_size + direction * moved);
      on_resize(latest);
    }, () => on_resize_end(latest));
  }

  function nudge(event: KeyboardEvent): void {
    const step = key_step(event, axis);
    if (step === null) return;
    event.preventDefault();
    on_resize_end(clamp(size + direction * step));
  }

  return (
    <div
      class={["resize-handle", axis === "vertical" && "vertical", class_name].filter(Boolean).join(" ")}
      role="separator"
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={start_drag}
      onDblClick={() => on_resize_end(default_size)}
      onKeyDown={nudge}
    />
  );
}

// ── Split ────────────────────────────────────────────────────────────────────

interface SplitProps {
  // Where the pane sizes are kept between visits, such as "x-music-split-main".
  storage_key: string;
  axis?: Axis;
  specs: PaneSpec[];
  preferred?: (number | undefined)[];
  panes: ComponentChildren[];
}

// Panes side by side or stacked, with a handle between each two; double-clicking a handle restores the first sizes.
export function Split({ storage_key, axis = "horizontal", specs, preferred, panes }: SplitProps) {
  const container = useRef<HTMLDivElement>(null);
  const [sizes, set_sizes] = useState<number[]>([]);
  const latest = useRef(sizes);
  latest.current = sizes;

  // The length the panes share: the container's less the handles between them.
  function extent(): number {
    const element = container.current;
    if (!element) return 0;
    const along = (child: HTMLElement): number => axis === "horizontal" ? child.offsetWidth : child.offsetHeight;
    const handles = [...element.querySelectorAll<HTMLElement>(":scope > .resize-handle")].reduce((sum, handle) => sum + along(handle), 0);
    return (axis === "horizontal" ? element.clientWidth : element.clientHeight) - handles;
  }

  function first_sizes(total: number): number[] {
    const saved = stored_sizes(storage_key, specs.length);
    return saved ? fit(saved, total, specs) : distribute(total, specs, preferred);
  }

  function change(next: number[], keep: boolean): void {
    set_sizes(next);
    if (keep) store_sizes(storage_key, next);
  }

  useEffect(() => {
    const total = extent();
    if (total > 0) set_sizes(first_sizes(total));

    // Sizing straight from the observer would resize what it watches, so the change waits for the next frame.
    let queued = 0;
    const observer = new ResizeObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        const length = extent();
        if (length <= 0) return;
        set_sizes(latest.current.length === specs.length ? fit(latest.current, length, specs) : first_sizes(length));
      });
    });
    observer.observe(container.current!);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      observer.disconnect();
    };
  }, []);

  function start_drag(index: number, event: PointerEvent): void {
    const before = [...latest.current];
    let moved_to = before;
    follow_drag(event.currentTarget as HTMLElement, event, axis, (moved) => {
      moved_to = resize_at(before, index, moved, specs);
      change(moved_to, false);
    }, () => store_sizes(storage_key, moved_to));
  }

  function nudge(index: number, event: KeyboardEvent): void {
    const step = key_step(event, axis);
    if (step === null) return;
    event.preventDefault();
    change(resize_at(sizes, index, step, specs), true);
  }

  const template = sizes.length === specs.length
    ? sizes.flatMap((size, index) => index === 0 ? [`${size}px`] : ["auto", `${size}px`]).join(" ")
    : specs.map(() => "1fr").join(" auto ");

  return (
    <div ref={container} class={`split ${axis}`} style={axis === "horizontal" ? { gridTemplateColumns: template } : { gridTemplateRows: template }}>
      {panes.map((pane, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <div
              class={axis === "horizontal" ? "resize-handle" : "resize-handle vertical"}
              role="separator"
              tabIndex={0}
              aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
              aria-label="Resize panes"
              aria-valuenow={sizes[index - 1] ?? 0}
              onPointerDown={(event) => start_drag(index - 1, event)}
              onKeyDown={(event) => nudge(index - 1, event)}
              onDblClick={() => change(distribute(extent(), specs, preferred), true)}
            />
          )}
          <div class="split-pane">{pane}</div>
        </Fragment>
      ))}
    </div>
  );
}
