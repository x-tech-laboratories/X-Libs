// A graph of nodes and links drawn by force, on force-graph (MIT): each node a shape and colour role by its kind,
// each link a solid or dashed line with an optional arrow and label. Selecting a node lights it and its neighbours
// and dims the rest; dragging pans, the wheel zooms, and Fit brings everything into view. The same nodes and links are
// a list under the drawing, walked with the keyboard like any tree, so the graph never needs a pointer. Colours come
// from Halon's tokens, read again when the theme changes, so light and dark both hold.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { ButtonGroup } from "./controls.tsx";
import { Empty } from "./states.tsx";
import { Tree } from "./tree.tsx";

// ── Shapes ───────────────────────────────────────────────────────────────────

// A colour role from Halon: the accent, a neutral grey, a status, or one of the chart series.
export type GraphTone = "accent" | "neutral" | "info" | "success" | "warning" | "danger" | "series-1" | "series-2" | "series-3" | "series-4" | "series-5" | "series-6";

export type GraphShape = "circle" | "square" | "diamond" | "hexagon";

export type GraphLinkStyle = "solid" | "dashed";

// A kind of node, named in the legend, with the shape and colour role its nodes take.
export interface GraphKind {
  id: string;
  label: string;
  tone: GraphTone;
  shape?: GraphShape;
}

export interface GraphNodeData {
  id: string;
  label: string;
  // One of the kinds given, which sets its shape and colour unless tone overrides it.
  kind: string;
  tone?: GraphTone;
  // A short glyph drawn in the node, such as a letter.
  icon?: string;
  // Drawn faded, such as something not yet accepted.
  faded?: boolean;
  // A line more about it, for its row in the list and the pointer's tooltip.
  detail?: string;
}

export interface GraphLinkData {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: GraphLinkStyle;
  tone?: GraphTone;
  // Draws an arrow at its end.
  directed?: boolean;
}

// A line of the legend for one style of link, such as "Proposed" for dashed ones.
export interface GraphLinkLegend {
  style: GraphLinkStyle;
  label: string;
}

export interface GraphLabels {
  zoom_in: string;
  zoom_out: string;
  fit: string;
  zoom: string;
  list: string;
  open: string;
  keys: string;
  links_of: (count: number) => string;
}

const default_labels: GraphLabels = {
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  fit: "Fit",
  zoom: "Zoom",
  list: "Nodes and their links",
  open: "Open",
  keys: "Arrow keys pan, + and − zoom, 0 fits; the list below walks every node and link.",
  links_of: (count) => `${count} link${count === 1 ? "" : "s"}`,
};

// ── Colours ──────────────────────────────────────────────────────────────────

// The Halon token each colour role reads.
export function tone_token(tone: GraphTone): string {
  if (tone === "accent") return "--accent";
  if (tone === "neutral") return "--text-tertiary";
  if (tone.startsWith("series-")) return `--${tone}`;
  return `--status-${tone}`;
}

export interface GraphPalette {
  tone: (tone: GraphTone) => string;
  text: string;
  muted: string;
  line: string;
  surface: string;
  focus: string;
  font: string;
}

// The colours the drawing uses, read from the tokens in force on the element, falling back to its text colour.
export function read_palette(element: Element): GraphPalette {
  const style = getComputedStyle(element);
  const fallback = style.color || "currentColor";
  const token = (name: string) => style.getPropertyValue(name).trim() || fallback;
  const tones = new Map<GraphTone, string>();
  return {
    tone: (tone) => {
      if (!tones.has(tone)) tones.set(tone, token(tone_token(tone)));
      return tones.get(tone)!;
    },
    text: token("--text-body"),
    muted: token("--text-tertiary"),
    line: token("--border-hover"),
    surface: token("--surface-default"),
    focus: token("--border-focus"),
    font: style.fontFamily || "sans-serif",
  };
}

// ── Neighbours ───────────────────────────────────────────────────────────────

// Each node's neighbours, by id.
export function neighbours_of(links: GraphLinkData[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    const set = found.get(from) ?? new Set<string>();
    set.add(to);
    found.set(from, set);
  };
  for (const link of links) {
    add(link.from, link.to);
    add(link.to, link.from);
  }
  return found;
}

// A node's radius: larger the more links it has, within reason.
export function node_radius(link_count: number): number {
  return 5 + Math.min(7, Math.sqrt(link_count) * 1.5);
}

export function dash_of(style: GraphLinkStyle | undefined): number[] | null {
  return style === "dashed" ? [4, 3] : null;
}

const longest_label = 40;

export function short_label(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > longest_label ? `${flat.slice(0, longest_label - 1)}…` : flat;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

// The simulation's copies: force-graph adds positions to nodes and swaps a link's ends for the node objects.
interface SimNode {
  id: string;
  data: GraphNodeData;
  radius: number;
  x?: number;
  y?: number;
}

interface SimLink {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  data: GraphLinkData;
}

function end_id(end: string | SimNode): string {
  return typeof end === "string" ? end : end.id;
}

// Below this zoom only the selection and its neighbours keep their labels, so a large graph stays readable.
const label_zoom = 1.4;
const fit_padding = 40;
const most_fit_zoom = 2;

export function trace_shape(context: CanvasRenderingContext2D, shape: GraphShape, x: number, y: number, radius: number): void {
  context.beginPath();
  if (shape === "square") context.rect(x - radius, y - radius, radius * 2, radius * 2);
  else if (shape === "diamond") {
    context.moveTo(x, y - radius * 1.25);
    context.lineTo(x + radius * 1.25, y);
    context.lineTo(x, y + radius * 1.25);
    context.lineTo(x - radius * 1.25, y);
    context.closePath();
  } else if (shape === "hexagon") {
    for (let corner = 0; corner < 6; corner++) {
      const angle = (Math.PI / 3) * corner;
      context.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
    }
    context.closePath();
  } else context.arc(x, y, radius, 0, Math.PI * 2);
}

interface DrawState {
  palette: GraphPalette;
  kinds: Map<string, GraphKind>;
  selected: string | null;
  lit: Set<string> | null;
}

// One node: its shape in its colour, faded when not lit, ringed when selected, with its glyph and its label.
export function draw_node(context: CanvasRenderingContext2D, node: SimNode, scale: number, state: DrawState): void {
  const kind = state.kinds.get(node.data.kind);
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const is_lit = state.lit === null || state.lit.has(node.id);
  context.globalAlpha = (is_lit ? 1 : 0.18) * (node.data.faded ? 0.55 : 1);
  trace_shape(context, kind?.shape ?? "circle", x, y, node.radius);
  context.fillStyle = state.palette.tone(node.data.tone ?? kind?.tone ?? "neutral");
  context.fill();
  if (node.data.faded) {
    context.setLineDash([2, 2]);
    context.strokeStyle = state.palette.text;
    context.lineWidth = 1 / scale;
    context.stroke();
    context.setLineDash([]);
  }
  if (node.id === state.selected) {
    trace_shape(context, kind?.shape ?? "circle", x, y, node.radius + 3 / scale);
    context.strokeStyle = state.palette.focus;
    context.lineWidth = 2 / scale;
    context.stroke();
  }
  if (node.data.icon) {
    context.fillStyle = state.palette.surface;
    context.font = `${node.radius}px ${state.palette.font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(node.data.icon, x, y);
  }
  if (scale >= label_zoom || (state.lit !== null && is_lit)) {
    const size = Math.max(10 / scale, 3);
    context.font = `${size}px ${state.palette.font}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillStyle = state.palette.text;
    context.fillText(short_label(node.data.label), x, y + node.radius + 2 / scale);
  }
  context.globalAlpha = 1;
}

// A link's label at its middle, over a patch of the surface so it reads across the line.
export function draw_link_label(context: CanvasRenderingContext2D, link: SimLink, scale: number, state: DrawState): void {
  const source = link.source as SimNode;
  const target = link.target as SimNode;
  const text = link.data.label;
  const touches = state.selected !== null && (source.id === state.selected || target.id === state.selected);
  if (!text || (scale < label_zoom && !touches)) return;
  const x = ((source.x ?? 0) + (target.x ?? 0)) / 2;
  const y = ((source.y ?? 0) + (target.y ?? 0)) / 2;
  const size = Math.max(9 / scale, 2.5);
  context.font = `${size}px ${state.palette.font}`;
  const width = context.measureText(text).width;
  context.fillStyle = state.palette.surface;
  context.fillRect(x - width / 2 - 1, y - size / 2 - 1, width + 2, size + 2);
  context.fillStyle = state.palette.muted;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y);
}

// What the page holds of a drawing: the force-graph instance and what it draws with.
interface Drawing {
  // The force-graph instance, typed loosely since its chainable methods are set at run time.
  graph: Record<string, (...args: unknown[]) => unknown>;
  state: DrawState;
  nodes: Map<string, SimNode>;
}

export interface GraphViewProps {
  // The drawing's name for screen readers, such as "Graph of Kitchen".
  label: string;
  nodes: GraphNodeData[];
  links: GraphLinkData[];
  kinds: GraphKind[];
  link_legend?: GraphLinkLegend[];
  selected_id?: string | null;
  on_select?: (id: string | null) => void;
  // A node opened by a double-click, or by its Open button in the list.
  on_activate?: (id: string) => void;
  on_link_select?: (id: string) => void;
  // Centres the drawing on this node whenever it changes, such as one a search found.
  focus_id?: string | null;
  // The drawing's height in pixels.
  height?: number;
  empty_title?: string;
  empty_hint?: ReactNode;
  labels?: Partial<GraphLabels>;
  // Things to show in the toolbar beside the zoom buttons, such as filters.
  tools?: ReactNode;
}

interface ListItem {
  id: string;
  parent_id: string | null;
  position: number;
  node?: GraphNodeData;
  link?: GraphLinkData;
  other?: GraphNodeData;
}

// A graph drawn by force with a list of the same nodes and links under it.
export function GraphView({
  label, nodes, links, kinds, link_legend = [], selected_id = null, on_select, on_activate, on_link_select, focus_id = null, height = 480, empty_title = "Nothing to show yet.", empty_hint, labels: given_labels, tools,
}: GraphViewProps) {
  const labels = { ...default_labels, ...given_labels };
  const box = useRef<HTMLDivElement>(null);
  const drawing = useRef<Drawing | null>(null);
  const handlers = useRef({ on_select, on_activate, on_link_select });
  handlers.current = { on_select, on_activate, on_link_select };
  const [expanded, set_expanded] = useState<Set<string>>(() => new Set());
  const kind_map = useMemo(() => new Map(kinds.map((kind) => [kind.id, kind])), [kinds]);
  const neighbours = useMemo(() => neighbours_of(links), [links]);
  const by_id = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const shown_links = useMemo(() => links.filter((link) => by_id.has(link.from) && by_id.has(link.to)), [links, by_id]);
  const is_empty = nodes.length === 0;
  const [ready, set_ready] = useState(0);
  const fit_pending = useRef(true);

  // The drawing starts once, loading force-graph only when a graph is shown.
  useEffect(() => {
    const element = box.current;
    if (!element || is_empty) return;
    let stopped = false;
    let observers: { disconnect: () => void }[] = [];
    void import("force-graph").then(({ default: ForceGraph }) => {
      if (stopped || !box.current) return;
      const state: DrawState = { palette: read_palette(element), kinds: kind_map, selected: null, lit: null };
      const graph = new (ForceGraph as unknown as new (element: HTMLElement) => Drawing["graph"])(element);
      const chain = (name: string, ...args: unknown[]) => graph[name]?.(...args);
      chain("width", element.clientWidth || 600);
      chain("height", height);
      chain("nodeId", "id");
      chain("warmupTicks", 60);
      chain("cooldownTime", 4000);
      chain("nodeLabel", (node: SimNode) => node.data.detail ? `${node.data.label}: ${node.data.detail}` : node.data.label);
      chain("nodeCanvasObject", (node: SimNode, context: CanvasRenderingContext2D, scale: number) => draw_node(context, node, scale, state));
      chain("nodePointerAreaPaint", (node: SimNode, colour: string, context: CanvasRenderingContext2D) => {
        context.fillStyle = colour;
        trace_shape(context, "circle", node.x ?? 0, node.y ?? 0, node.radius + 3);
        context.fill();
      });
      chain("linkColor", (link: SimLink) => {
        const touches = state.selected !== null && (end_id(link.source) === state.selected || end_id(link.target) === state.selected);
        return touches ? state.palette.focus : link.data.tone ? state.palette.tone(link.data.tone) : state.palette.line;
      });
      chain("linkWidth", (link: SimLink) => (state.selected !== null && (end_id(link.source) === state.selected || end_id(link.target) === state.selected) ? 2 : 1));
      chain("linkLineDash", (link: SimLink) => dash_of(link.data.style));
      chain("linkDirectionalArrowLength", (link: SimLink) => (link.data.directed ? 4 : 0));
      chain("linkDirectionalArrowRelPos", 1);
      chain("linkCanvasObjectMode", () => "after");
      chain("linkCanvasObject", (link: SimLink, context: CanvasRenderingContext2D, scale: number) => draw_link_label(context, link, scale, state));
      chain("onNodeClick", (node: SimNode, event: MouseEvent) => {
        if (event.detail >= 2) handlers.current.on_activate?.(node.id);
        else handlers.current.on_select?.(node.id);
      });
      chain("onLinkClick", (link: SimLink) => handlers.current.on_link_select?.(link.id));
      chain("onBackgroundClick", () => handlers.current.on_select?.(null));
      chain("onEngineStop", () => {
        if (fit_pending.current) {
          fit_pending.current = false;
          fit(drawing.current);
        }
      });
      drawing.current = { graph, state, nodes: new Map() };
      set_ready((count) => count + 1);
      const repaint = () => {
        state.palette = read_palette(element);
        chain("nodeCanvasObject", (node: SimNode, context: CanvasRenderingContext2D, scale: number) => draw_node(context, node, scale, state));
      };
      const theme = new MutationObserver(repaint);
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
      const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => element.clientWidth > 0 && chain("width", element.clientWidth));
      sizes?.observe(element);
      const scheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
      scheme?.addEventListener?.("change", repaint);
      observers = [theme, ...(sizes ? [sizes] : []), { disconnect: () => scheme?.removeEventListener?.("change", repaint) }];
    }).catch((error: unknown) => console.warn("graph:", error));
    return () => {
      stopped = true;
      for (const observer of observers) observer.disconnect();
      drawing.current?.graph._destructor?.();
      drawing.current = null;
    };
  }, [is_empty]);

  // New data keeps each node's place, so the drawing moves on rather than starting over.
  useEffect(() => {
    const current = drawing.current;
    if (!current) return;
    const counts = new Map<string, number>();
    for (const link of shown_links) for (const end of [link.from, link.to]) counts.set(end, (counts.get(end) ?? 0) + 1);
    const next = new Map(nodes.map((node) => {
      const before = current.nodes.get(node.id);
      return [node.id, { ...before, id: node.id, data: node, radius: node_radius(counts.get(node.id) ?? 0) } as SimNode];
    }));
    if (current.nodes.size === 0) fit_pending.current = true;
    current.nodes = next;
    current.state.kinds = kind_map;
    current.graph.graphData?.({ nodes: [...next.values()], links: shown_links.map((link) => ({ id: link.id, source: link.from, target: link.to, data: link })) });
  }, [ready, nodes, shown_links, kind_map]);

  // The selection lights its neighbours.
  useEffect(() => {
    const current = drawing.current;
    if (!current) return;
    current.state.selected = selected_id;
    current.state.lit = selected_id === null ? null : new Set([selected_id, ...(neighbours.get(selected_id) ?? [])]);
    current.graph.nodeCanvasObject?.((node: SimNode, context: CanvasRenderingContext2D, scale: number) => draw_node(context, node, scale, current.state));
  }, [ready, selected_id, neighbours]);

  useEffect(() => {
    const node = focus_id ? drawing.current?.nodes.get(focus_id) : undefined;
    if (!node || node.x === undefined) return;
    drawing.current!.graph.centerAt?.(node.x, node.y, 400);
    drawing.current!.graph.zoom?.(Math.max(2, Number(drawing.current!.graph.zoom?.()) || 0), 400);
  }, [ready, focus_id]);

  function zoom_by(factor: number): void {
    const graph = drawing.current?.graph;
    const now = Number(graph?.zoom?.()) || 1;
    graph?.zoom?.(now * factor, 200);
  }

  function pan_by(dx: number, dy: number): void {
    const graph = drawing.current?.graph;
    const centre = graph?.centerAt?.() as { x: number; y: number } | undefined;
    const scale = Number(graph?.zoom?.()) || 1;
    if (centre) graph?.centerAt?.(centre.x + dx / scale, centre.y + dy / scale, 150);
  }

  function key_down(event: KeyboardEvent<HTMLDivElement>): void {
    const steps: Record<string, () => void> = {
      "+": () => zoom_by(1.25),
      "=": () => zoom_by(1.25),
      "-": () => zoom_by(0.8),
      "0": () => fit(drawing.current),
      ArrowLeft: () => pan_by(-60, 0),
      ArrowRight: () => pan_by(60, 0),
      ArrowUp: () => pan_by(0, -60),
      ArrowDown: () => pan_by(0, 60),
      Enter: () => selected_id !== null && on_activate?.(selected_id),
      Escape: () => on_select?.(null),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    step();
  }

  // ── The list ───────────────────────────────────────────────────────────────

  const items = useMemo(() => {
    const ordered = [...nodes].sort((first, second) => first.label.localeCompare(second.label));
    const list: ListItem[] = ordered.map((node, position) => ({ id: node.id, parent_id: null, position, node }));
    for (const node of ordered) {
      if (!expanded.has(node.id)) continue;
      shown_links
        .filter((link) => link.from === node.id || link.to === node.id)
        .forEach((link, position) => list.push({ id: `${node.id}\u0000${link.id}`, parent_id: node.id, position, link, other: by_id.get(link.from === node.id ? link.to : link.from) }));
    }
    return list;
  }, [nodes, shown_links, expanded, by_id]);
  const link_counts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of shown_links) for (const end of new Set([link.from, link.to])) counts.set(end, (counts.get(end) ?? 0) + 1);
    return counts;
  }, [shown_links]);
  const collapsed = useMemo(() => new Set(nodes.filter((node) => !expanded.has(node.id)).map((node) => node.id)), [nodes, expanded]);

  if (is_empty) return <Empty title={empty_title} hint={empty_hint} />;

  const swatch = (tone: GraphTone): CSSProperties => ({ ["--swatch" as string]: `var(${tone_token(tone)})` });
  return (
    <div>
      <div className="toolbar">
        {tools}
        <ButtonGroup label={labels.zoom}>
          <button type="button" aria-label={labels.zoom_out} title={labels.zoom_out} onClick={() => zoom_by(0.8)}>−</button>
          <button type="button" aria-label={labels.zoom_in} title={labels.zoom_in} onClick={() => zoom_by(1.25)}>+</button>
          <button type="button" onClick={() => fit(drawing.current)}>{labels.fit}</button>
        </ButtonGroup>
      </div>
      <figure className="chart flow-map-frame">
        <div ref={box} role="img" aria-label={label} aria-roledescription="graph" title={labels.keys} tabIndex={0} onKeyDown={key_down} style={{ height, overflow: "hidden" }} />
      </figure>
      <p className="muted small share-legend">
        {kinds.map((kind) => <span key={kind.id} className="legend" style={swatch(kind.tone)}>{kind.label}</span>)}
        {link_legend.map((entry) => (
          <span key={entry.style + entry.label}>
            <svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4" stroke="currentColor" strokeDasharray={entry.style === "dashed" ? "4 3" : undefined} /></svg> {entry.label}
          </span>
        ))}
      </p>
      <Tree<ListItem>
        label={labels.list}
        items={items}
        collapsed={collapsed}
        has_children={(item) => item.node !== undefined && (link_counts.get(item.id) ?? 0) > 0}
        on_collapsed_change={(next) => set_expanded(new Set(nodes.filter((node) => !next.has(node.id)).map((node) => node.id)))}
        name_of={(item) => item.node?.label ?? item.other?.label ?? ""}
        selected_id={selected_id}
        on_select={(item) => {
          if (item.node) on_select?.(item.id);
          else if (item.link && on_link_select) on_link_select(item.link.id);
          else if (item.other) on_select?.(item.other.id);
        }}
        on_activate={(item) => item.node && on_activate?.(item.id)}
        render_item={(item) =>
          item.node ? (
            <span>
              {item.node.label}
              <span className="muted"> · {kind_map.get(item.node.kind)?.label ?? item.node.kind}{item.node.detail ? ` · ${item.node.detail}` : ""}</span>
            </span>
          ) : (
            <span>
              <span className="muted">{item.link!.label || "linked to"}{item.link!.style === "dashed" ? " (dashed)" : ""} </span>
              {item.other?.label ?? ""}
            </span>
          )
        }
        render_extra={(item) =>
          item.node ? (
            <span className="tree-extra">
              <span className="muted small">{labels.links_of(link_counts.get(item.id) ?? 0)}</span>
              {on_activate && <button type="button" className="small" onClick={() => on_activate(item.id)}>{labels.open}</button>}
            </span>
          ) : null
        }
      />
    </div>
  );
}

// Brings every node into view, no closer than a comfortable zoom.
function fit(current: Drawing | null): void {
  const graph = current?.graph;
  if (!graph || ![...(current?.nodes.values() ?? [])].some((node) => Number.isFinite(node.x))) return;
  graph.zoomToFit?.(300, fit_padding);
  if ((Number(graph.zoom?.()) || 0) > most_fit_zoom) graph.zoom?.(most_fit_zoom);
}
