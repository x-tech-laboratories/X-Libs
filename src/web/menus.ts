// What a menu item holds, where a menu opened at a point goes so it stays on screen, and which item a key moves to.

export interface MenuItem {
  label: string;
  run: () => void;
  // A right-aligned hint, such as a keyboard shortcut.
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  separator_before?: boolean;
  // Set on an item that is ticked on or off, and shows whether it is ticked now.
  checked?: boolean;
  // Makes a ticked item one choice of several, such as a filter's.
  radio?: boolean;
  // Leaves the menu open after the item runs, such as for ticking several columns.
  keep_open?: boolean;
}

const edge_gap = 4;

// Flipped to the point's other side near an edge, or pushed back from the edge when neither side has room.
export function on_screen_position(x: number, y: number, width: number, height: number, room_width = window.innerWidth, room_height = window.innerHeight): { left: number; top: number } {
  const place = (start: number, size: number, room: number): number => {
    if (start + size + edge_gap <= room) return start;
    if (start - size >= edge_gap) return start - size;
    return Math.max(edge_gap, room - size - edge_gap);
  };
  return { left: place(x, width, room_width), top: place(y, height, room_height) };
}

// ── Keys ─────────────────────────────────────────────────────────────────────

// The item an arrow, Home or End key moves to from the current one, wrapping round, or null for any other key.
export function item_after_key(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown": return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp": return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

// The first item after the current one whose label starts with the typed text, or null when none does.
export function item_starting_with(labels: readonly string[], typed: string, current: number): number | null {
  const wanted = typed.toLocaleLowerCase();
  // A repeated first letter steps on through the items that start with it.
  const repeated = wanted.length > 1 && [...wanted].every((letter) => letter === wanted[0]);
  const prefix = repeated ? wanted[0]! : wanted;
  const start = repeated || wanted.length === 1 ? current + 1 : Math.max(current, 0);
  for (let offset = 0; offset < labels.length; offset += 1) {
    const index = (start + offset) % labels.length;
    if (labels[index]!.trim().toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return null;
}
