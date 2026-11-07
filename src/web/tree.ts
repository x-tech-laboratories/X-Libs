// Trees of rows that name their parent and their place among siblings, and where a dragged or keyed row lands.

export interface TreeItem {
  id: string;
  parent_id: string | null;
  position: number;
}

export interface TreeNode<Item> {
  item: Item;
  children: TreeNode<Item>[];
}

export type SidePlacement = "before" | "after";
export type DropPlacement = SidePlacement | "inside";

export interface TreeMove {
  parent_id: string | null;
  position: number;
}

// Siblings are ordered by position unless by_list_order keeps them in the order the list gives, such as one already sorted on screen.
export interface DropOptions {
  by_list_order?: boolean;
}

// ── Shape ────────────────────────────────────────────────────────────────────

export function by_position<Item extends { position: number }>(first: Item, second: Item): number {
  return first.position - second.position;
}

export function children_of<Item extends TreeItem>(parent_id: string | null, items: Item[]): Item[] {
  return items.filter((item) => item.parent_id === parent_id);
}

// The item itself plus everything below it, at any depth.
export function subtree_ids(item_id: string, items: TreeItem[]): Set<string> {
  const ids = new Set([item_id]);

  for (const id of ids) {
    for (const child of children_of(id, items)) ids.add(child.id);
  }

  return ids;
}

// Each shown item sits under its nearest ancestor that is also shown, or at the top when none is, in the order given.
export function nest<Item extends TreeItem>(shown: Item[], all: Item[] = shown): TreeNode<Item>[] {
  const item_by_id = new Map(all.map((item) => [item.id, item]));
  const node_by_id = new Map(shown.map((item) => [item.id, { item, children: [] as TreeNode<Item>[] }]));
  const top_nodes: TreeNode<Item>[] = [];

  for (const node of node_by_id.values()) {
    const seen = new Set([node.item.id]);
    let ancestor_id = node.item.parent_id;
    while (ancestor_id && !node_by_id.has(ancestor_id) && !seen.has(ancestor_id)) {
      seen.add(ancestor_id);
      ancestor_id = item_by_id.get(ancestor_id)?.parent_id ?? null;
    }

    if (ancestor_id && node_by_id.has(ancestor_id) && !seen.has(ancestor_id)) node_by_id.get(ancestor_id)!.children.push(node);
    else top_nodes.push(node);
  }

  return top_nodes;
}

// Every item in tree order: each followed by the items below it, siblings by position, each set of siblings reversed when asked.
export function in_tree_order<Item extends TreeItem>(items: Item[], reversed = false): Item[] {
  const sorted = [...items].sort(by_position);
  if (reversed) sorted.reverse();
  const walk = (nodes: TreeNode<Item>[]): Item[] => nodes.flatMap((node) => [node.item, ...walk(node.children)]);
  const ordered = walk(nest(sorted, items));
  const reached = new Set(ordered);
  return [...ordered, ...sorted.filter((item) => !reached.has(item))];
}

// The names from the top of the tree down to the item, such as ["Work", "Clients"]; stops at a missing parent or a loop.
export function path_names<Item extends TreeItem>(item: Item, items: Item[], name_of: (item: Item) => string): string[] {
  const item_by_id = new Map(items.map((each) => [each.id, each]));
  const path = [item];
  let parent = item.parent_id === null ? undefined : item_by_id.get(item.parent_id);
  while (parent && !path.includes(parent)) {
    path.unshift(parent);
    parent = parent.parent_id === null ? undefined : item_by_id.get(parent.parent_id);
  }
  return path.map(name_of);
}

// ── Dropping ─────────────────────────────────────────────────────────────────

// The top and bottom quarters of a row drop beside it and the middle drops into it, or halves when nothing drops inside.
export function placement_at(fraction_down: number, allow_inside: boolean): DropPlacement {
  if (!allow_inside) return fraction_down < 0.5 ? "before" : "after";
  if (fraction_down < 0.25) return "before";
  if (fraction_down > 0.75) return "after";
  return "inside";
}

// A row cannot drop onto itself or anything below it.
export function can_drop(dragged_id: string, target_id: string, items: TreeItem[]): boolean {
  return !subtree_ids(dragged_id, items).has(target_id);
}

// Picks a position between the neighbours at the drop point, so only the moved item changes.
function position_beside<Item extends { id: string; position: number }>(siblings: Item[], target: Item, placement: SidePlacement, options: DropOptions = {}): number {
  const sorted = options.by_list_order ? siblings : [...siblings].sort(by_position);
  const index = sorted.findIndex((sibling) => sibling.id === target.id);
  const neighbour = sorted[placement === "before" ? index - 1 : index + 1];
  if (!neighbour) return placement === "before" ? target.position - 1 : target.position + 1;
  return (target.position + neighbour.position) / 2;
}

// For a flat list, where items only move before or after each other.
export function position_for_drop<Item extends { id: string; position: number }>(dragged: Item, target: Item, placement: SidePlacement, items: Item[], options: DropOptions = {}): number {
  return position_beside(items.filter((item) => item.id !== dragged.id), target, placement, options);
}

// Inside drops after the target's last child; before and after drop among the target's siblings.
export function move_for_drop<Item extends TreeItem>(dragged: Item, target: Item, placement: DropPlacement, items: Item[], options: DropOptions = {}): TreeMove {
  const others = items.filter((item) => item.id !== dragged.id);

  if (placement === "inside") {
    const last_child_position = Math.max(target.position, ...children_of(target.id, others).map((item) => item.position));
    return { parent_id: target.id, position: last_child_position + 1 };
  }

  return { parent_id: target.parent_id, position: position_beside(children_of(target.parent_id, others), target, placement, options) };
}

// Moves several items together, keeping their order: inside the target after its last child, or in a run between it and its neighbour.
export function moves_for_drop<Item extends TreeItem>(dragged: Item[], target: Item, placement: DropPlacement, items: Item[], options: DropOptions = {}): TreeMove[] {
  const dragged_ids = new Set(dragged.map((item) => item.id));
  const others = items.filter((item) => !dragged_ids.has(item.id));

  if (placement === "inside") {
    const last_child_position = Math.max(target.position, ...children_of(target.id, others).map((item) => item.position));
    return dragged.map((_, index) => ({ parent_id: target.id, position: last_child_position + index + 1 }));
  }

  const siblings = children_of(target.parent_id, others);
  if (!options.by_list_order) siblings.sort(by_position);
  const index = siblings.findIndex((sibling) => sibling.id === target.id);
  const neighbour = siblings[placement === "before" ? index - 1 : index + 1];
  const low = placement === "before" ? (neighbour?.position ?? target.position - 1) : target.position;
  const high = placement === "before" ? target.position : (neighbour?.position ?? target.position + 1);
  return dragged.map((_, index) => ({ parent_id: target.parent_id, position: low + ((high - low) * (index + 1)) / (dragged.length + 1) }));
}

// ── Keyboard moves ───────────────────────────────────────────────────────────

export type KeyMove = "up" | "down" | "indent" | "outdent";

// Up and down pass the sibling beside it, indent goes last inside the sibling above, outdent goes after its parent; null when it cannot go that way.
export function key_drop<Item extends TreeItem>(item: Item, direction: KeyMove, items: Item[]): { target: Item; placement: DropPlacement } | null {
  const siblings = children_of(item.parent_id, items).sort(by_position);
  const index = siblings.findIndex((sibling) => sibling.id === item.id);
  const above = siblings[index - 1];
  const below = siblings[index + 1];
  const parent = items.find((each) => each.id === item.parent_id);

  if (direction === "up") return above ? { target: above, placement: "before" } : null;
  if (direction === "down") return below ? { target: below, placement: "after" } : null;
  if (direction === "indent") return above ? { target: above, placement: "inside" } : null;
  return parent ? { target: parent, placement: "after" } : null;
}

export function move_for_key<Item extends TreeItem>(item: Item, direction: KeyMove, items: Item[]): TreeMove | null {
  const drop = key_drop(item, direction, items);
  return drop && move_for_drop(item, drop.target, drop.placement, items);
}
