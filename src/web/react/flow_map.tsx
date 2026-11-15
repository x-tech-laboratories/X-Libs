// A map of how things flow from column to column, such as folders through jobs to repositories or flakes through
// caches to hosts: boxes in columns, optionally under group boxes, joined by curved lines colored by tone. Hovering or
// focusing a box lights everything upstream and downstream of it and dims the rest; dragging pans and Ctrl or ⌘ with
// the wheel zooms. Each column is ordered by where its lines come from, so the lines mostly run straight across.

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { ButtonGroup } from "./controls.tsx";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type FlowTone = "ok" | "running" | "warning" | "critical" | "unknown";

export interface FlowDetail {
  text: string;
  // Set in monospace, such as a path.
  mono?: boolean;
}

export interface FlowNode {
  id: string;
  label: string;
  // Sets the label in monospace, such as a path.
  mono?: boolean;
  // Draws a dot before the label in this tone; no dot when absent.
  tone?: FlowTone;
  // Lines under the label.
  details?: FlowDetail[];
  href?: string | null;
  // The tooltip; the label and details unless given.
  title?: string;
}

// A box around some of a column's nodes, such as the host they are on.
export interface FlowGroup {
  id: string;
  label: string;
  href?: string | null;
  title?: string;
  nodes: FlowNode[];
}

// A column holds groups, nodes outside any group, or both; a column of loose nodes alone sits in the middle of the height.
export interface FlowColumn {
  title: string;
  width?: number;
  groups?: FlowGroup[];
  nodes?: FlowNode[];
}

// A line from a node to a node in a column further right.
export interface FlowLink {
  from: string;
  to: string;
  tone?: FlowTone;
  title?: string;
}

export interface FlowMapControls {
  fit: () => void;
  zoom: (factor: number) => void;
}

// Keeps a map's zoom across a redraw or a remount, and hands its zoom and fit to buttons drawn elsewhere.
export interface FlowMapHandle {
  view_box: { current: Box | null };
  controls: { current: FlowMapControls | null };
}

export function use_flow_map(): FlowMapHandle {
  const view_box = useRef<Box | null>(null);
  const controls = useRef<FlowMapControls | null>(null);
  return useMemo(() => ({ view_box, controls }), []);
}

// ── Layout ───────────────────────────────────────────────────────────────────

const default_width = 260;
// The room between columns that the lines cross.
const corridor = 150;
const padding = 12;
const heading_height = 30;
const group_head = 34;
const group_gap = 16;
const node_gap = 8;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedNode {
  node: FlowNode;
  column: number;
  box: Box;
}

export interface FlowLayout {
  nodes: Map<string, PlacedNode>;
  groups: { group: FlowGroup; box: Box }[];
  columns: { title: string; x: number }[];
  width: number;
  height: number;
}

// A node's height: one row for its label and one for each detail.
export function node_height(node: FlowNode): number {
  const details = node.details?.length ?? 0;
  return details === 0 ? 28 : 46 + 14 * (details - 1);
}

export interface Slot {
  group: FlowGroup | null;
  nodes: FlowNode[];
}

// Sweeps right, left and right again, sorting each column's nodes within their groups and the groups themselves by the
// mean place of the nodes they link to in the columns already ordered; ties and unlinked nodes keep the order given.
export function order_columns(columns: FlowColumn[], links: FlowLink[]): Slot[][] {
  const slots = columns.map((column): Slot[] => [
    ...(column.groups ?? []).map((group) => ({ group, nodes: [...group.nodes] })),
    ...(column.nodes?.length ? [{ group: null, nodes: [...column.nodes] }] : []),
  ]);
  const column_of = new Map<string, number>();
  slots.forEach((column, index) => { for (const slot of column) for (const node of slot.nodes) column_of.set(node.id, index); });
  const neighbours = new Map<string, string[]>();
  for (const link of links) {
    if (!column_of.has(link.from) || !column_of.has(link.to)) continue;
    neighbours.set(link.from, [...neighbours.get(link.from) ?? [], link.to]);
    neighbours.set(link.to, [...neighbours.get(link.to) ?? [], link.from]);
  }
  const rank = new Map<string, number>();
  const rank_column = (index: number) => slots[index].flatMap((slot) => slot.nodes).forEach((node, place) => rank.set(node.id, place / Math.max(1, slots[index].reduce((sum, slot) => sum + slot.nodes.length, 0))));
  slots.forEach((_, index) => rank_column(index));
  const mean = (values: number[]) => values.length === 0 ? Infinity : values.reduce((sum, value) => sum + value, 0) / values.length;
  const sort_column = (index: number, toward: (other: number) => boolean) => {
    const key = new Map<string, number>();
    for (const slot of slots[index]) for (const node of slot.nodes) {
      key.set(node.id, mean((neighbours.get(node.id) ?? []).filter((other) => toward(column_of.get(other)!)).map((other) => rank.get(other)!)));
    }
    // Unlinked nodes keep their place at the end; a stable sort keeps the given order among ties.
    const by_key = (left: number, right: number) => (left === right ? 0 : left === Infinity ? 1 : right === Infinity ? -1 : left - right);
    for (const slot of slots[index]) slot.nodes.sort((left, right) => by_key(key.get(left.id)!, key.get(right.id)!));
    const group_key = (slot: Slot) => mean(slot.nodes.map((node) => key.get(node.id)!).filter(Number.isFinite));
    // The loose nodes stay below the groups.
    const loose = slots[index].filter((slot) => slot.group === null);
    const grouped = slots[index].filter((slot) => slot.group !== null).sort((left, right) => by_key(group_key(left), group_key(right)));
    slots[index] = [...grouped, ...loose];
    rank_column(index);
  };
  for (let index = 1; index < slots.length; index++) sort_column(index, (other) => other < index);
  for (let index = slots.length - 2; index >= 0; index--) sort_column(index, (other) => other > index);
  for (let index = 1; index < slots.length; index++) sort_column(index, (other) => other < index);
  return slots;
}

export function layout(columns: FlowColumn[], links: FlowLink[]): FlowLayout {
  const slots = order_columns(columns, links);
  const top = padding + heading_height;
  const placed_columns: FlowLayout["columns"] = [];
  let x = padding;
  for (const column of columns) {
    placed_columns.push({ title: column.title, x });
    x += (column.width ?? default_width) + corridor;
  }

  const nodes = new Map<string, PlacedNode>();
  const groups: FlowLayout["groups"] = [];
  const stack = (index: number, width: number, column_nodes: FlowNode[], from: number, inset: number) => {
    let y = from;
    for (const node of column_nodes) {
      const height = node_height(node);
      nodes.set(node.id, { node, column: index, box: { x: placed_columns[index].x + inset, y, width: width - 2 * inset, height } });
      y += height + node_gap;
    }
    return y - (column_nodes.length > 0 ? node_gap : 0);
  };

  // Columns with groups stack from the top; a column of loose nodes alone waits to be centred on the tallest.
  const bottoms: number[] = [];
  const centred: number[] = [];
  slots.forEach((column, index) => {
    const width = columns[index].width ?? default_width;
    if (column.every((slot) => slot.group === null)) {
      centred.push(index);
      return;
    }
    let y = top;
    for (const slot of column) {
      if (slot.group === null) {
        y = stack(index, width, slot.nodes, y, 0) + group_gap;
        continue;
      }
      const start = y;
      y = stack(index, width, slot.nodes, y + group_head, padding) + padding;
      groups.push({ group: slot.group, box: { x: placed_columns[index].x, y: start, width, height: y - start } });
      y += group_gap;
    }
    bottoms.push(y - group_gap);
  });
  const loose_height = (index: number) => slots[index].flatMap((slot) => slot.nodes).reduce((sum, node) => sum + node_height(node) + node_gap, 0) - node_gap;
  const tallest = Math.max(top, ...bottoms, ...centred.map((index) => top + loose_height(index)));
  for (const index of centred) {
    const from = top + Math.max(0, (tallest - top - loose_height(index)) / 2);
    bottoms.push(stack(index, columns[index].width ?? default_width, slots[index].flatMap((slot) => slot.nodes), from, 0));
  }

  const last = columns.length - 1;
  return {
    nodes,
    groups,
    columns: placed_columns,
    width: last < 0 ? 2 * padding : placed_columns[last].x + (columns[last].width ?? default_width) + padding,
    height: Math.max(top, ...bottoms) + padding,
  };
}

// Every node upstream and downstream of a node, itself included, which hovering it lights.
export function reachable(links: FlowLink[], id: string): Set<string> {
  const found = new Set([id]);
  const walk = (from: string, next: (link: FlowLink) => [string, string]) => {
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const link of links) {
        const [start, end] = next(link);
        if (start !== at || seen.has(end)) continue;
        seen.add(end);
        found.add(end);
        queue.push(end);
      }
    }
  };
  walk(id, (link) => [link.from, link.to]);
  walk(id, (link) => [link.to, link.from]);
  return found;
}

// A curve from one box's right side to a box's left side further right.
function flow_path(from: Box, from_y: number, to: Box, to_y: number): string {
  const [x1, x2] = [from.x + from.width, to.x];
  const bend = (x2 - x1) / 2;
  return `M${x1},${from_y}C${x1 + bend},${from_y} ${x2 - bend},${to_y} ${x2},${to_y}`;
}

// Where each line meets a box's side, spread along it in the order of the boxes at their other ends so they never cross there.
function ports(lines: { key: number; at: Box; other_y: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  const by_box = new Map<Box, typeof lines>();
  for (const line of lines) by_box.set(line.at, [...by_box.get(line.at) ?? [], line]);
  for (const [box, group] of by_box) {
    group.sort((left, right) => left.other_y - right.other_y)
      .forEach((line, index) => out.set(line.key, box.y + box.height * (index + 1) / (group.length + 1)));
  }
  return out;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

// The boxes and lines of the map, without its view box, which the map's handlers move.
function Drawing({ placed, links }: { placed: FlowLayout; links: FlowLink[] }) {
  const centre = (box: Box) => box.y + box.height / 2;
  const drawn = links.filter((link) => placed.nodes.has(link.from) && placed.nodes.has(link.to));
  const box_of = (id: string) => placed.nodes.get(id)!.box;
  const out = ports(drawn.map((link, key) => ({ key, at: box_of(link.from), other_y: centre(box_of(link.to)) })));
  const into = ports(drawn.map((link, key) => ({ key, at: box_of(link.to), other_y: centre(box_of(link.from)) })));

  return (
    <>
      <g className="flows">
        {drawn.map((link, key) => (
          <path key={`${link.from}>${link.to}`} className={`flow flow-tone-${link.tone ?? "ok"}`} data-from={link.from} data-to={link.to}
            d={flow_path(box_of(link.from), out.get(key)!, box_of(link.to), into.get(key)!)}>
            <title>{link.title ?? `${placed.nodes.get(link.from)!.node.label} → ${placed.nodes.get(link.to)!.node.label}`}</title>
          </path>
        ))}
      </g>
      <g>
        {placed.columns.map((column) => <text key={column.x} className="flow-column" x={column.x} y={padding + 14}>{column.title}</text>)}
        {placed.groups.map(({ group, box }) => {
          const name = <text className="flow-group-name" x={box.x + padding} y={box.y + 22}>{clip(group.label, box.width - 2 * padding, 8)}</text>;
          return [
            <rect key={`${group.id}-box`} className="flow-group" x={box.x} y={box.y} width={box.width} height={box.height} rx={10} />,
            group.href
              ? <a key={`${group.id}-name`} href={group.href}>{name}<title>{group.title ?? `${group.label}: open its page`}</title></a>
              : <g key={`${group.id}-name`}>{name}{group.title && <title>{group.title}</title>}</g>,
          ];
        })}
        {[...placed.nodes.values()].map(({ node, box }) => <NodeBox key={node.id} node={node} box={box} />)}
      </g>
    </>
  );
}

function NodeBox({ node, box }: { node: FlowNode; box: Box }) {
  const details = node.details ?? [];
  const indent = node.tone === undefined ? 10 : 24;
  const label_y = box.y + (details.length === 0 ? 18 : 21);
  const children: ReactNode = <>
    <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={6} />
    {node.tone !== undefined && <circle className="flow-dot" cx={box.x + 14} cy={box.y + 17} r={4} />}
    <text className={node.mono ? "flow-path" : "flow-name"} x={box.x + indent} y={label_y}>{clip(node.label, box.width - indent - 10, node.mono ? 7.4 : 7.8)}</text>
    {details.map((detail, index) => (
      <text key={index} className={detail.mono ? "flow-path" : "flow-detail"} x={box.x + 10} y={box.y + 37 + 14 * index}>{clip(detail.text, box.width - 20, detail.mono ? 7.4 : 6.2)}</text>
    ))}
    <title>{node.title ?? [node.label, ...details.map((detail) => detail.text)].join("\n")}</title>
  </>;
  const class_name = `flow-node${node.tone === undefined ? "" : ` flow-tone-${node.tone}`}`;
  return node.href
    ? <a className={class_name} data-node={node.id} href={node.href}>{children}</a>
    : <g className={class_name} data-node={node.id} tabIndex={0}>{children}</g>;
}

// Shortens a label to about the width it has, since SVG text never wraps or ellipsises.
function clip(label: string, width: number, char_width = 6.2): string {
  const room = Math.floor(width / char_width);
  return label.length <= room ? label : `${label.slice(0, Math.max(1, room - 1))}…`;
}

// ── Map ──────────────────────────────────────────────────────────────────────

const tone_labels: Record<FlowTone, string> = { ok: "OK", running: "Running", warning: "Warning", critical: "Critical", unknown: "Unknown" };

// The drawn map, which keeps the reader's zoom across a redraw after a change; a handle from `use_flow_map` keeps it
// across a remount too and lets `FlowMapZoom` drive it. `legend` names the tones the lines use, in the order given.
export function FlowMap({ label, columns, links, handle, legend = [] }: {
  label: string;
  columns: FlowColumn[];
  links: FlowLink[];
  handle?: FlowMapHandle;
  legend?: FlowTone[];
}) {
  const own = use_flow_map();
  const { view_box, controls } = handle ?? own;
  const drawing = useRef<SVGSVGElement>(null);
  const snapshot = JSON.stringify([columns, links]);
  const placed = useMemo(() => layout(columns, links), [snapshot]);
  // A refresh that changes nothing leaves the drawing, and whatever is lit, alone.
  const content = useMemo(() => <Drawing placed={placed} links={links} />, [snapshot]);
  const whole = useRef<Box>({ x: 0, y: 0, width: placed.width, height: placed.height });
  whole.current = { x: 0, y: 0, width: placed.width, height: placed.height };
  const current_links = useRef(links);
  current_links.current = links;

  const set_view = (box: Box) => {
    view_box.current = box;
    drawing.current?.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  };
  const zoom = (factor: number, centre?: { x: number; y: number }) => {
    const box = view_box.current ?? whole.current;
    const width = Math.min(whole.current.width * 2, Math.max(whole.current.width / 8, box.width * factor));
    const height = width * box.height / box.width;
    const point = centre ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    set_view({ x: point.x - (point.x - box.x) * width / box.width, y: point.y - (point.y - box.y) * height / box.height, width, height });
  };

  useLayoutEffect(() => {
    set_view(view_box.current ?? whole.current);
    controls.current = { fit: () => set_view(whole.current), zoom };
  }, [snapshot]);

  useEffect(() => {
    const element = drawing.current!;
    const stop_highlight = highlight_on_hover(element, () => current_links.current);
    const stop_panning = pan_and_zoom(element, () => view_box.current ?? whole.current, set_view, zoom);
    return () => {
      stop_highlight();
      stop_panning();
      controls.current = null;
    };
  }, []);

  return (
    <>
      <figure className="chart flow-map-frame">
        <svg ref={drawing} className="flow-map" role="img" aria-label={label}>{content}</svg>
      </figure>
      <p className="muted small flow-map-legend">
        {legend.map((tone) => <span key={tone} className={`legend flow-swatch-${tone}`}>{tone_labels[tone]}</span>)}
        <span>Drag to pan, Ctrl or ⌘ and scroll to zoom. Hover a box to follow its lines.</span>
      </p>
    </>
  );
}

// Zoom out, zoom in and Fit buttons for a map's section heading.
export function FlowMapZoom({ handle }: { handle: FlowMapHandle }) {
  return (
    <ButtonGroup label="Zoom">
      <button type="button" aria-label="Zoom out" onClick={() => handle.controls.current?.zoom(1.25)}>−</button>
      <button type="button" aria-label="Zoom in" onClick={() => handle.controls.current?.zoom(0.8)}>+</button>
      <button type="button" onClick={() => handle.controls.current?.fit()}>Fit</button>
    </ButtonGroup>
  );
}

// Lights every node upstream and downstream of whatever the pointer or focus is on, and the lines between them; the rest dims.
function highlight_on_hover(drawing: SVGElement, links: () => FlowLink[]): () => void {
  const light = (target: Element | null) => {
    for (const lit of drawing.querySelectorAll(".lit")) lit.classList.remove("lit");
    const node = target?.closest<SVGElement>("[data-node]");
    drawing.classList.toggle("focused", node !== null && node !== undefined);
    if (!node) return;
    const lit = reachable(links(), node.dataset.node!);
    for (const item of drawing.querySelectorAll<SVGElement>("[data-node]")) if (lit.has(item.dataset.node!)) item.classList.add("lit");
    for (const item of drawing.querySelectorAll<SVGElement>("[data-from]")) {
      if (lit.has(item.dataset.from!) && lit.has(item.dataset.to!)) item.classList.add("lit");
    }
  };
  const over = (event: Event) => light(event.target as Element);
  const away = () => light(null);
  drawing.addEventListener("pointerover", over);
  drawing.addEventListener("pointerleave", away);
  drawing.addEventListener("focusin", over);
  drawing.addEventListener("focusout", away);
  return () => {
    drawing.removeEventListener("pointerover", over);
    drawing.removeEventListener("pointerleave", away);
    drawing.removeEventListener("focusin", over);
    drawing.removeEventListener("focusout", away);
  };
}

// Dragging pans and Ctrl or ⌘ with the wheel zooms about the pointer; a drag never counts as a click on a link.
function pan_and_zoom(drawing: SVGSVGElement, view: () => Box, set_view: (box: Box) => void, zoom: (factor: number, centre: { x: number; y: number }) => void): () => void {
  const to_map = (event: { clientX: number; clientY: number }) => {
    const bounds = drawing.getBoundingClientRect();
    const box = view();
    return { x: box.x + (event.clientX - bounds.left) / bounds.width * box.width, y: box.y + (event.clientY - bounds.top) / bounds.height * box.height };
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoom(Math.exp(event.deltaY * 0.002), to_map(event));
  };

  let start: { x: number; y: number; box: Box } | null = null;
  let dragged = false;
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, box: view() };
    dragged = false;
  };
  const move = (event: PointerEvent) => {
    if (!start) return;
    const [dx, dy] = [event.clientX - start.x, event.clientY - start.y];
    if (!dragged && Math.hypot(dx, dy) < 4) return;
    if (!dragged) drawing.setPointerCapture?.(event.pointerId);
    dragged = true;
    drawing.classList.add("panning");
    const bounds = drawing.getBoundingClientRect();
    set_view({ ...start.box, x: start.box.x - dx / bounds.width * start.box.width, y: start.box.y - dy / bounds.height * start.box.height });
  };
  const stop = () => {
    start = null;
    drawing.classList.remove("panning");
  };
  const click = (event: MouseEvent) => {
    if (!dragged) return;
    event.preventDefault();
    dragged = false;
  };

  drawing.addEventListener("wheel", wheel, { passive: false });
  drawing.addEventListener("pointerdown", down);
  drawing.addEventListener("pointermove", move);
  drawing.addEventListener("pointerup", stop);
  drawing.addEventListener("pointercancel", stop);
  drawing.addEventListener("click", click, true);
  return () => {
    drawing.removeEventListener("wheel", wheel);
    drawing.removeEventListener("pointerdown", down);
    drawing.removeEventListener("pointermove", move);
    drawing.removeEventListener("pointerup", stop);
    drawing.removeEventListener("pointercancel", stop);
    drawing.removeEventListener("click", click, true);
  };
}
