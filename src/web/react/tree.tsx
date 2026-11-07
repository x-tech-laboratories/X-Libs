// A tree of rows: fold and unfold, walk it with the arrow keys, and reorder it by dragging or with Alt and the arrow keys.

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  by_position, can_drop as is_outside_subtree, key_drop, move_for_drop, nest, placement_at,
  type DropPlacement, type KeyMove, type TreeItem, type TreeMove, type TreeNode,
} from "../tree.ts";

export type { DropPlacement, TreeItem, TreeMove } from "../tree.ts";

interface TreeProps<Item extends TreeItem> {
  items: Item[];
  // The tree's name for screen readers, such as "Tags".
  label: string;
  render_item: (item: Item) => ReactNode;
  // What a row shows at its end, such as a count, badges or a row button.
  render_extra?: (item: Item) => ReactNode;
  // A row's plain name, for its fold button.
  name_of?: (item: Item) => string;
  // The ids of the rows folded shut.
  collapsed: ReadonlySet<string>;
  on_collapsed_change: (collapsed: Set<string>) => void;
  selected_id?: string | null;
  // Several rows shown selected at once, beside selected_id.
  selected_ids?: ReadonlySet<string>;
  on_select?: (item: Item) => void;
  // Called when a row is double-clicked, such as to open its editor.
  on_activate?: (item: Item) => void;
  // A class for a row, such as one that marks a group heading.
  row_class?: (item: Item) => string | undefined;
  // Called when a row is dropped or moved with Alt and an arrow key; the tree reorders only once items change.
  on_move?: (item: Item, move: TreeMove) => void;
  // Narrows where a row may land; a row never lands on itself or anything below it.
  can_drop?: (dragged: Item, target: Item, placement: DropPlacement) => boolean;
  // Whether a row can be dropped into another as its child.
  allow_inside?: boolean;
  // An inline form for a new row, shown last among the children of parent_id, or last in the tree when that is null.
  new_item?: { parent_id: string | null; form: ReactNode } | null;
  on_context_menu?: (event: MouseEvent<HTMLElement>, item: Item) => void;
  // Called while something not from this tree is dragged over a row; return true to accept it there.
  accepts_external?: (event: DragEvent<HTMLElement>, item: Item) => boolean;
  // Called when such a drag is dropped on a row that accepted it; the row shows drop-inside while hovered.
  on_external_drop?: (event: DragEvent<HTMLElement>, item: Item) => void;
}

const KEY_MOVES: Record<string, KeyMove> = { ArrowUp: "up", ArrowDown: "down", ArrowRight: "indent", ArrowLeft: "outdent" };

// The rows a person can see, top to bottom, skipping those inside folded rows.
function visible_nodes<Item extends TreeItem>(nodes: TreeNode<Item>[], collapsed: ReadonlySet<string>): TreeNode<Item>[] {
  return nodes.flatMap((node) => [node, ...(collapsed.has(node.item.id) ? [] : visible_nodes(node.children, collapsed))]);
}

export function Tree<Item extends TreeItem>({
  items, label, render_item, render_extra, name_of, collapsed, on_collapsed_change, selected_id = null, selected_ids, on_select, on_activate, row_class: class_of,
  on_move, can_drop, allow_inside = true, new_item = null, on_context_menu, accepts_external, on_external_drop,
}: TreeProps<Item>) {
  const [focused_id, set_focused_id] = useState<string | null>(null);
  const [dragged_id, set_dragged_id] = useState<string | null>(null);
  const [drop_target, set_drop_target] = useState<{ id: string; placement: DropPlacement } | null>(null);
  const row_elements = useRef(new Map<string, HTMLLIElement>());
  const moves_focus = useRef(false);

  const roots = nest([...items].sort(by_position), items);
  const shown = visible_nodes(roots, collapsed);
  const is_selected = (id: string) => selected_id === id || Boolean(selected_ids?.has(id));
  const first_selected = shown.find((node) => selected_ids?.has(node.item.id))?.item.id ?? null;
  const tab_stop = [focused_id, selected_id, first_selected].find((id) => id !== null && shown.some((node) => node.item.id === id)) ?? shown[0]?.item.id;

  useEffect(() => {
    if (!moves_focus.current || focused_id === null) return;
    moves_focus.current = false;
    row_elements.current.get(focused_id)?.focus();
  }, [focused_id, items]);

  // ── Folding ────────────────────────────────────────────────────────────────

  function set_collapsed(id: string, is_collapsed: boolean): void {
    if (collapsed.has(id) === is_collapsed) return;
    const next = new Set(collapsed);
    if (is_collapsed) next.add(id);
    else next.delete(id);
    on_collapsed_change(next);
  }

  // ── Moving ─────────────────────────────────────────────────────────────────

  function is_allowed(dragged: Item, target: Item, placement: DropPlacement): boolean {
    if (placement === "inside" && !allow_inside) return false;
    return is_outside_subtree(dragged.id, target.id, items) && (can_drop?.(dragged, target, placement) ?? true);
  }

  // A row dropped into a folded one unfolds it, so the moved row stays in sight.
  function move(item: Item, target: Item, placement: DropPlacement): void {
    if (placement === "inside") set_collapsed(target.id, false);
    on_move!(item, move_for_drop(item, target, placement, items));
  }

  function placement_over(event: DragEvent<HTMLElement>, target: Item): DropPlacement | null {
    const dragged = items.find((item) => item.id === dragged_id);
    if (!dragged) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const placement = placement_at(box.height > 0 ? (event.clientY - box.top) / box.height : 0.5, allow_inside);
    return is_allowed(dragged, target, placement) ? placement : null;
  }

  // A drag from outside the tree, such as a task, lands inside the row that accepts it.
  function accepts_from_outside(event: DragEvent<HTMLElement>, target: Item): boolean {
    return dragged_id === null && Boolean(accepts_external?.(event, target));
  }

  function drag_over(event: DragEvent<HTMLElement>, target: Item): void {
    const external = accepts_from_outside(event, target);
    const placement = external ? "inside" : placement_over(event, target);
    if (!placement) return;
    event.preventDefault();
    // An outside drag keeps the effect its source allowed, which may not include a move.
    if (event.dataTransfer && !external) event.dataTransfer.dropEffect = "move";
    if (drop_target?.id !== target.id || drop_target.placement !== placement) set_drop_target({ id: target.id, placement });
  }

  function drop(event: DragEvent<HTMLElement>, target: Item): void {
    if (accepts_from_outside(event, target)) {
      event.preventDefault();
      end_drag();
      on_external_drop?.(event, target);
      return;
    }
    const placement = placement_over(event, target);
    const dragged = items.find((item) => item.id === dragged_id);
    end_drag();
    if (!placement || !dragged) return;
    event.preventDefault();
    move(dragged, target, placement);
  }

  function end_drag(): void {
    set_dragged_id(null);
    set_drop_target(null);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  function focus_row(id: string | undefined): void {
    if (id === undefined) return;
    moves_focus.current = true;
    set_focused_id(id);
  }

  function key_down(event: KeyboardEvent<HTMLUListElement>): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[role='treeitem']");
    if (row !== event.target) return;
    const index = shown.findIndex((node) => node.item.id === row.dataset.id);
    const node = shown[index];
    if (!node) return;
    const { item } = node;
    const is_open = node.children.length > 0 && !collapsed.has(item.id);

    if (event.altKey && on_move && KEY_MOVES[event.key]) {
      const key_target = key_drop(item, KEY_MOVES[event.key]!, items);
      if (key_target && is_allowed(item, key_target.target, key_target.placement)) {
        move(item, key_target.target, key_target.placement);
        focus_row(item.id);
      }
    } else if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    } else if (event.key === "ArrowDown") focus_row(shown[index + 1]?.item.id);
    else if (event.key === "ArrowUp") focus_row(shown[index - 1]?.item.id);
    else if (event.key === "Home") focus_row(shown[0]?.item.id);
    else if (event.key === "End") focus_row(shown.at(-1)?.item.id);
    else if (event.key === "ArrowRight") {
      if (is_open) focus_row(node.children[0]!.item.id);
      else if (node.children.length > 0) set_collapsed(item.id, false);
      else return;
    } else if (event.key === "ArrowLeft") {
      if (is_open) set_collapsed(item.id, true);
      else if (item.parent_id !== null && shown.some((each) => each.item.id === item.parent_id)) focus_row(item.parent_id);
      else return;
    } else if ((event.key === "Enter" || event.key === " ") && on_select) on_select(item);
    else return;
    event.preventDefault();
  }

  // ── Rows ───────────────────────────────────────────────────────────────────

  function new_item_row(parent_id: string | null) {
    if (!new_item || new_item.parent_id !== parent_id) return null;
    return <li role="none" className="tree-new">{new_item.form}</li>;
  }

  function branch(node: TreeNode<Item>, depth: number): ReactNode {
    const { item, children } = node;
    const has_children = children.length > 0;
    const is_collapsed = collapsed.has(item.id);
    const name = name_of?.(item) ?? "row";
    const new_child = new_item_row(item.id);
    const row_class = [
      "tree-row",
      class_of?.(item),
      dragged_id === item.id && "dragging",
      drop_target?.id === item.id && `drop-${drop_target.placement}`,
    ].filter(Boolean).join(" ");

    return (
      <li
        key={item.id}
        ref={(element) => { if (element) row_elements.current.set(item.id, element); else row_elements.current.delete(item.id); }}
        role="treeitem"
        className="tree-item"
        data-id={item.id}
        aria-level={depth + 1}
        aria-expanded={has_children ? !is_collapsed : undefined}
        aria-selected={on_select || selected_ids ? is_selected(item.id) : undefined}
        tabIndex={tab_stop === item.id ? 0 : -1}
        onFocus={(event) => { if (event.target === event.currentTarget) set_focused_id(item.id); }}
      >
        <div
          className={row_class}
          draggable={on_move ? true : undefined}
          onDragStart={(event) => {
            event.dataTransfer?.setData("text/plain", item.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            set_dragged_id(item.id);
          }}
          onDragEnd={end_drag}
          onDragOver={(event) => drag_over(event, item)}
          onDragLeave={() => { if (drop_target?.id === item.id) set_drop_target(null); }}
          onDrop={(event) => drop(event, item)}
          onClick={() => { focus_row(item.id); on_select?.(item); }}
          onDoubleClick={on_activate && (() => on_activate(item))}
          onContextMenu={on_context_menu && ((event) => on_context_menu(event, item))}
        >
          {has_children
            ? (
              <button
                type="button"
                className="tree-toggle"
                tabIndex={-1}
                aria-label={is_collapsed ? `Expand ${name}` : `Collapse ${name}`}
                onClick={(event) => { event.stopPropagation(); set_collapsed(item.id, !is_collapsed); }}
              >
                <span aria-hidden="true">{is_collapsed ? "▸" : "▾"}</span>
              </button>
            )
            : <span className="tree-toggle" aria-hidden="true" />}
          <span className="tree-label">{render_item(item)}</span>
          {render_extra && <span className="tree-extra">{render_extra(item)}</span>}
        </div>
        {((has_children && !is_collapsed) || new_child) && (
          <ul role="group" className="tree-children">
            {!is_collapsed && children.map((child) => branch(child, depth + 1))}
            {new_child}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul role="tree" className="tree" aria-label={label} aria-multiselectable={selected_ids ? true : undefined} onKeyDown={key_down}>
      {roots.map((node) => branch(node, 0))}
      {new_item_row(null)}
    </ul>
  );
}
