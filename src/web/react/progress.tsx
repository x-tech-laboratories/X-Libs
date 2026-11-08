// A bar that fills as work gets done, with its words beside it.

import type { CSSProperties, ReactNode } from "react";
import { cx } from "../dom.ts";

interface ProgressBarProps {
  // How far along, out of max; null while the amount of work is still unknown, which draws the bar busy.
  value: number | null;
  max?: number;
  label: string;
  // Words beside the bar, such as "120 / 600"; the percentage when true.
  detail?: ReactNode | true;
  class_name?: string;
}

// The fill reads its width from --progress, as Halon's seek slider reads --range-progress.
export function ProgressBar({ value, max = 100, label, detail, class_name }: ProgressBarProps) {
  const known = value !== null && max > 0;
  const percent = known ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const words = detail === true ? `${percent}%` : detail;
  return (
    <div className={cx("progress", class_name)}>
      <div
        className={cx("progress-bar", !known && "indeterminate")}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={known ? value : undefined}
        style={{ "--progress": `${percent}%` } as CSSProperties}
      >
        <div className="progress-fill" />
      </div>
      {words !== undefined && <span className="progress-detail muted">{words}</span>}
    </div>
  );
}
