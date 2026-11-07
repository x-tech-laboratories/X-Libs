// Picking rows in a list: plain, Ctrl and Shift clicks, an anchor ranges measure from, and the row an arrow or page key moves to.

// ── Intents ──────────────────────────────────────────────────────────────────

// A range replaces the picks, so Shift+arrow can shrink again; range-add keeps them, for Ctrl+Shift.
export type SelectionIntent = "replace" | "toggle" | "range" | "range-add";

export function intent_for(modifiers: { shift?: boolean; ctrl?: boolean }): SelectionIntent {
  if (modifiers.shift) return modifiers.ctrl ? "range-add" : "range";
  return modifiers.ctrl ? "toggle" : "replace";
}

// ── Selection ────────────────────────────────────────────────────────────────

export class Selection<Id = number> {
  private readonly picked = new Set<Id>();
  private anchor: number | null = null;

  get size(): number {
    return this.picked.size;
  }

  has(id: Id): boolean {
    return this.picked.has(id);
  }

  ids(): Id[] {
    return [...this.picked];
  }

  // The picks and the anchor, for finding why a range came out wrong.
  inspect(): { size: number; anchor: number | null } {
    return { size: this.picked.size, anchor: this.anchor };
  }

  clear(): void {
    this.picked.clear();
    this.anchor = null;
  }

  // Applies a click on the row at index in the list as shown.
  apply(ordered: readonly Id[], index: number, intent: SelectionIntent): void {
    if (index < 0 || index >= ordered.length) return;
    const id = ordered[index]!;

    if (intent === "replace") {
      this.picked.clear();
      this.picked.add(id);
      this.anchor = index;
      return;
    }
    if (intent === "toggle") {
      if (this.picked.has(id)) this.picked.delete(id);
      else this.picked.add(id);
      this.anchor = index;
      return;
    }

    // The anchor stays put, so every extension measures from the same row.
    const from = this.anchor ?? index;
    const [low, high] = from <= index ? [from, index] : [index, from];
    if (intent === "range") this.picked.clear();
    for (let row = low; row <= high; row += 1) this.picked.add(ordered[row]!);
  }

  select_all(ordered: readonly Id[]): void {
    for (const id of ordered) this.picked.add(id);
  }

  invert(ordered: readonly Id[]): void {
    const next = ordered.filter((id) => !this.picked.has(id));
    this.picked.clear();
    for (const id of next) this.picked.add(id);
  }

  // Drops picks no longer in the list, such as after a filter narrows it.
  retain(ordered: readonly Id[]): void {
    const kept = new Set(ordered);
    for (const id of this.picked) if (!kept.has(id)) this.picked.delete(id);
  }
}

// ── Keys ─────────────────────────────────────────────────────────────────────

// The row an arrow, page, Home or End key moves to, held inside the list, or null for any other key.
export function row_after_key(key: string, current: number, last: number, rows_per_page: number): number | null {
  const clamp = (row: number): number => Math.min(last, Math.max(0, row));
  switch (key) {
    case "ArrowDown": return clamp(current + 1);
    case "ArrowUp": return clamp(current - 1);
    case "PageDown": return clamp(current + rows_per_page);
    case "PageUp": return clamp(current - rows_per_page);
    case "Home": return 0;
    case "End": return Math.max(0, last);
    default: return null;
  }
}
