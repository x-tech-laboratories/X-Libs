// What a menu item holds, and where a menu opened at a point goes so it stays on screen.

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
