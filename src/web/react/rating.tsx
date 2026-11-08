// A row of stars that shows a rating and takes a new one by click or keyboard.

import type { KeyboardEvent } from "react";
import { cx } from "../dom.ts";

interface RatingProps {
  // How many stars are lit, or null when unrated, which is not the same as none.
  value: number | null;
  max?: number;
  label?: string;
  // Without it the stars only show.
  on_change?: (value: number | null) => void;
}

const plural_stars = (count: number): string => `${count} star${count === 1 ? "" : "s"}`;

// Arrow keys move one star, Home and End to the ends, and Delete or 0 clears the rating.
export function Rating({ value, max = 5, label = "Rating", on_change }: RatingProps) {
  const lit = value ?? 0;
  const read_only = on_change === undefined;

  function key_down(event: KeyboardEvent<HTMLDivElement>): void {
    if (read_only) return;
    const next = event.key === "ArrowRight" || event.key === "ArrowUp" ? Math.min(max, lit + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? Math.max(0, lit - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? max
      : event.key === "Delete" || event.key === "Backspace" || event.key === "0" ? null
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    on_change(next);
  }

  return (
    <div
      className={cx("rating", read_only && "read-only")}
      role="slider"
      tabIndex={read_only ? undefined : 0}
      aria-label={label}
      aria-readonly={read_only || undefined}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={lit}
      aria-valuetext={value === null ? "Unrated" : plural_stars(value)}
      onKeyDown={key_down}
    >
      {Array.from({ length: max }, (_, index) => index + 1).map((star) => (
        <button
          key={star}
          type="button"
          className={cx("star", star <= lit && "on")}
          tabIndex={-1}
          disabled={read_only}
          aria-label={plural_stars(star)}
          onClick={() => on_change?.(star)}
        >★</button>
      ))}
    </div>
  );
}
