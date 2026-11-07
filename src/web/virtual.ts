// Which rows of a long list a scrolled viewport needs, so only those are drawn.

export interface VirtualWindow {
  // The first row to draw, counting the overscan.
  start: number;
  // The row after the last one to draw.
  end: number;
  // How far down the first drawn row sits.
  offset_px: number;
  // The height of the whole list.
  total_px: number;
}

export function virtual_window(total_rows: number, row_height: number, scroll_top: number, viewport_height: number, overscan = 8): VirtualWindow {
  if (row_height <= 0) throw new Error("row_height must be positive");
  const first_visible = Math.floor(Math.max(0, scroll_top) / row_height);
  const visible_count = Math.ceil(viewport_height / row_height);
  const start = Math.max(0, first_visible - overscan);
  const end = Math.min(total_rows, first_visible + visible_count + overscan);
  return { start, end, offset_px: start * row_height, total_px: total_rows * row_height };
}
