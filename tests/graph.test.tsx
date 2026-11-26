// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// force-graph draws on a canvas jsdom lacks, so a fake records what the widget asks of it.
const made: FakeGraph[] = [];

class FakeGraph {
  calls: Record<string, unknown[][]> = {};
  scale = 1;
  centre = { x: 0, y: 0 };
  element: HTMLElement;
  constructor(element: HTMLElement) {
    this.element = element;
    made.push(this);
    return new Proxy(this, {
      get: (target, name: string) => {
        if (name in target) return (target as unknown as Record<string, unknown>)[name];
        return (...args: unknown[]) => {
          (target.calls[name] ??= []).push(args);
          if (name === "zoom") {
            if (args.length === 0) return target.scale;
            target.scale = Number(args[0]);
          }
          if (name === "centerAt") {
            if (args.length === 0) return target.centre;
            target.centre = { x: Number(args[0]), y: Number(args[1]) };
          }
          return target;
        };
      },
    });
  }
  last(name: string): unknown[] | undefined {
    return this.calls[name]?.at(-1);
  }
}

vi.mock("force-graph", () => ({ default: FakeGraph }));

import { dash_of, draw_link_label, draw_node, GraphView, neighbours_of, node_radius, read_palette, short_label, tone_token, trace_shape, type GraphKind, type GraphLinkData, type GraphNodeData } from "../src/web/react/graph.tsx";

beforeEach(() => {
  made.length = 0;
});
afterEach(cleanup);

const kinds: GraphKind[] = [
  { id: "task", label: "Task", tone: "accent" },
  { id: "person", label: "Person", tone: "series-2", shape: "hexagon" },
];
const nodes: GraphNodeData[] = [
  { id: "t1", label: "Order seeds", kind: "task", detail: "open" },
  { id: "p1", label: "Ada", kind: "person", icon: "A" },
  { id: "p2", label: "Bob", kind: "person", faded: true },
];
const links: GraphLinkData[] = [
  { id: "l1", from: "t1", to: "p1", label: "mentions", directed: true },
  { id: "l2", from: "p1", to: "p2", label: "related", style: "dashed" },
  { id: "gone", from: "p1", to: "nobody" },
];

// Lets the widget's dynamic import of force-graph settle.
async function settle(): Promise<FakeGraph> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return made.at(-1)!;
}

test("reads its colours from Halon's tokens, by role", () => {
  expect(tone_token("accent")).toBe("--accent");
  expect(tone_token("neutral")).toBe("--text-tertiary");
  expect(tone_token("series-3")).toBe("--series-3");
  expect(tone_token("danger")).toBe("--status-danger");
  document.documentElement.style.setProperty("--accent", "rgb(1, 2, 3)");
  document.documentElement.style.color = "rgb(9, 9, 9)";
  const palette = read_palette(document.documentElement);
  expect(palette.tone("accent")).toBe("rgb(1, 2, 3)");
  expect(palette.tone("accent")).toBe("rgb(1, 2, 3)");
  // A token not set falls back to the text colour rather than any colour of its own.
  expect(palette.tone("warning")).toBe("rgb(9, 9, 9)");
  document.documentElement.removeAttribute("style");
});

test("knows each node's neighbours, sizes nodes by their links and dashes dashed links", () => {
  expect([...neighbours_of(links).get("p1")!].sort()).toEqual(["nobody", "p2", "t1"]);
  expect(node_radius(0)).toBe(5);
  expect(node_radius(100)).toBe(12);
  expect(dash_of("dashed")).toEqual([4, 3]);
  expect(dash_of("solid")).toBeNull();
  expect(short_label("a ".repeat(40))).toHaveLength(40);
});

// A canvas context that notes what was drawn.
function fake_context() {
  const drawn: string[] = [];
  const context = {
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "",
    beginPath: () => drawn.push("path"), rect: () => drawn.push("rect"), arc: () => drawn.push("arc"), moveTo: () => undefined, lineTo: () => drawn.push("line"),
    closePath: () => undefined, fill: () => drawn.push("fill"), stroke: () => drawn.push("stroke"), setLineDash: () => undefined,
    fillText: (text: string) => drawn.push(`text:${text}`), fillRect: () => drawn.push("box"), measureText: (text: string) => ({ width: text.length * 4 }),
  };
  return { context: context as unknown as CanvasRenderingContext2D, drawn };
}

test("draws a node in its kind's shape, faded outside the selection, ringed when chosen, and labels it", () => {
  const palette = { tone: (tone: string) => `tone:${tone}`, text: "text", muted: "muted", line: "line", surface: "surface", focus: "focus", font: "sans" };
  const state = { palette, kinds: new Map(kinds.map((kind) => [kind.id, kind])), selected: "p1", lit: new Set(["p1", "t1"]) };
  const { context, drawn } = fake_context();
  draw_node(context, { id: "p1", data: nodes[1]!, radius: 6, x: 0, y: 0 }, 1, state);
  expect(drawn.filter((step) => step === "line").length).toBeGreaterThanOrEqual(12);
  expect(drawn).toContain("text:A");
  expect(drawn).toContain("text:Ada");
  expect(drawn.filter((step) => step === "stroke")).toHaveLength(1);

  const away = fake_context();
  draw_node(away.context, { id: "p2", data: nodes[2]!, radius: 6 }, 1, state);
  expect(away.drawn).not.toContain("text:Bob");
  expect(away.drawn).toContain("stroke");
  draw_node(away.context, { id: "t1", data: nodes[0]!, radius: 6 }, 2, { ...state, selected: null, lit: null });
  expect(away.drawn).toContain("text:Order seeds");

  for (const shape of ["square", "diamond", "circle"] as const) {
    const each = fake_context();
    trace_shape(each.context, shape, 0, 0, 4);
    expect(each.drawn.length).toBeGreaterThan(0);
  }

  const label = fake_context();
  const link = { id: "l1", source: { id: "t1", data: nodes[0]!, radius: 5, x: 0, y: 0 }, target: { id: "p1", data: nodes[1]!, radius: 5, x: 10, y: 10 }, data: links[0]! };
  draw_link_label(label.context, link, 1, state);
  expect(label.drawn).toEqual(["box", "text:mentions"]);
  const quiet = fake_context();
  draw_link_label(quiet.context, link, 1, { ...state, selected: null });
  expect(quiet.drawn).toEqual([]);
});

test("shows an empty state when there is nothing to draw", () => {
  render(<GraphView label="Graph" nodes={[]} links={[]} kinds={kinds} empty_title="No links yet." empty_hint="Suggest some." />);
  expect(screen.getByText("No links yet.")).toBeTruthy();
  expect(screen.getByText("Suggest some.")).toBeTruthy();
  expect(made).toHaveLength(0);
});

test("draws the nodes and the links between nodes it has, with a legend and a list walked by keyboard", async () => {
  const on_select = vi.fn();
  const on_activate = vi.fn();
  const on_link_select = vi.fn();
  render(
    <GraphView
      label="Graph of the garden"
      nodes={nodes}
      links={links}
      kinds={kinds}
      link_legend={[{ style: "dashed", label: "Proposed" }]}
      on_select={on_select}
      on_activate={on_activate}
      on_link_select={on_link_select}
      tools={<span>Filters</span>}
    />,
  );
  const graph = await settle();
  const data = graph.last("graphData")![0] as { nodes: { id: string; radius: number }[]; links: { id: string }[] };
  expect(data.nodes.map((node) => node.id)).toEqual(["t1", "p1", "p2"]);
  expect(data.links.map((link) => link.id)).toEqual(["l1", "l2"]);
  expect(data.nodes[1]!.radius).toBeGreaterThan(data.nodes[2]!.radius);
  expect(screen.getByRole("img", { name: "Graph of the garden" })).toBeTruthy();
  expect(screen.getByText("Person")).toBeTruthy();
  expect(screen.getByText("Proposed")).toBeTruthy();
  expect(screen.getByText("Filters")).toBeTruthy();

  // The list holds every node, by name, each with how many links it has, and folds open on its links.
  const tree = screen.getByRole("tree", { name: "Nodes and their links" });
  const rows = within(tree).getAllByRole("treeitem");
  expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Ada"), expect.stringContaining("Bob"), expect.stringContaining("Order seeds")]);
  expect(rows[0]!.textContent).toContain("2 links");
  fireEvent.click(within(rows[0]!).getByRole("button", { name: "Expand Ada" }));
  const opened = within(tree).getAllByRole("treeitem");
  expect(opened.map((row) => row.textContent)).toEqual(expect.arrayContaining(["mentions Order seeds", "related (dashed) Bob"]));
  fireEvent.keyDown(opened[1]!, { key: "Enter" });
  expect(on_link_select).toHaveBeenCalledWith("l1");
  fireEvent.keyDown(rows[1]!, { key: "Enter" });
  expect(on_select).toHaveBeenCalledWith("p2");
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Open" }));
  expect(on_activate).toHaveBeenCalledWith("p2");

  // Clicks on the drawing select, open, choose a link or clear the selection.
  const callback = (name: string) => graph.last(name)![0] as (...args: unknown[]) => void;
  callback("onNodeClick")({ id: "t1" }, { detail: 1 });
  expect(on_select).toHaveBeenLastCalledWith("t1");
  callback("onNodeClick")({ id: "t1" }, { detail: 2 });
  expect(on_activate).toHaveBeenLastCalledWith("t1");
  callback("onLinkClick")({ id: "l2" });
  expect(on_link_select).toHaveBeenLastCalledWith("l2");
  callback("onBackgroundClick")();
  expect(on_select).toHaveBeenLastCalledWith(null);
  const link_colour = graph.last("linkColor")![0] as (link: unknown) => string;
  expect(typeof link_colour({ source: "t1", target: "p1", data: links[0] })).toBe("string");
  expect((graph.last("linkLineDash")![0] as (link: unknown) => unknown)({ data: links[1] })).toEqual([4, 3]);
  expect((graph.last("nodeLabel")![0] as (node: unknown) => string)({ data: nodes[0] })).toBe("Order seeds: open");
});

test("zooms, pans, fits and centres on a node asked for, from buttons and keys", async () => {
  const on_select = vi.fn();
  const on_activate = vi.fn();
  const view = render(<GraphView label="Graph" nodes={nodes} links={links} kinds={kinds} selected_id="p1" on_select={on_select} on_activate={on_activate} />);
  const graph = await settle();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(graph.scale).toBeCloseTo(1.25);
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(graph.scale).toBeCloseTo(1);

  // Nothing is placed yet, so there is nothing to fit; once placed, Fit fits.
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(graph.calls.zoomToFit).toBeUndefined();
  const placed = graph.last("graphData")![0] as { nodes: { id: string; x?: number; y?: number }[] };
  for (const [index, node] of placed.nodes.entries()) Object.assign(node, { x: index * 10, y: 5 });
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(graph.calls.zoomToFit).toHaveLength(1);
  // The zoom is held to a comfortable one once the fit has moved.
  graph.scale = 4;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(graph.scale).toBe(3);
  (graph.last("onEngineStop")![0] as () => void)();
  expect(graph.calls.zoomToFit).toHaveLength(2);

  const drawing = screen.getByRole("img", { name: "Graph" });
  fireEvent.keyDown(drawing, { key: "+" });
  expect(graph.scale).toBeCloseTo(3.75);
  fireEvent.keyDown(drawing, { key: "ArrowRight" });
  expect(graph.centre.x).toBeCloseTo(16);
  for (const key of ["ArrowLeft", "ArrowUp", "ArrowDown", "-", "0", "x"]) fireEvent.keyDown(drawing, { key });
  fireEvent.keyDown(drawing, { key: "Enter" });
  expect(on_activate).toHaveBeenCalledWith("p1");
  fireEvent.keyDown(drawing, { key: "Escape" });
  expect(on_select).toHaveBeenCalledWith(null);

  view.rerender(<GraphView label="Graph" nodes={nodes} links={links} kinds={kinds} selected_id="p1" focus_id="p2" />);
  expect(graph.centre).toEqual({ x: 20, y: 5 });

  // A theme change reads the colours again; leaving stops the drawing.
  const before = graph.calls.nodeCanvasObject!.length;
  document.documentElement.setAttribute("data-theme", "dark");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(graph.calls.nodeCanvasObject!.length).toBeGreaterThan(before);
  document.documentElement.removeAttribute("data-theme");
  view.unmount();
  expect(graph.calls._destructor).toHaveLength(1);
});

test("keeps a node's place when the data changes", async () => {
  const view = render(<GraphView label="Graph" nodes={nodes} links={links} kinds={kinds} />);
  const graph = await settle();
  const first = graph.last("graphData")![0] as { nodes: { id: string; x?: number }[] };
  first.nodes[0]!.x = 42;
  view.rerender(<GraphView label="Graph" nodes={[...nodes, { id: "t2", label: "Sow", kind: "task" }]} links={links} kinds={kinds} />);
  const second = graph.last("graphData")![0] as { nodes: { id: string; x?: number }[] };
  expect(second.nodes.find((node) => node.id === "t1")!.x).toBe(42);
  expect(second.nodes).toHaveLength(4);
});

test("fits again when the drawing changes width, such as when a pane beside it opens", async () => {
  const watched: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) {
      watched.push(callback);
    }
    observe() {}
    disconnect() {}
  });
  render(<GraphView label="Graph" nodes={nodes} links={links} kinds={kinds} />);
  const graph = await settle();
  const placed = graph.last("graphData")![0] as { nodes: { x?: number; y?: number }[] };
  for (const node of placed.nodes) Object.assign(node, { x: 1, y: 1 });
  const box = screen.getByRole("img", { name: "Graph" });
  Object.defineProperty(box, "clientWidth", { value: 380, configurable: true });
  graph.scale = 5;
  watched[0]!();
  expect(graph.last("width")).toEqual([380]);
  expect(graph.calls.zoomToFit).toHaveLength(1);
  expect(graph.scale).toBe(3);
  vi.unstubAllGlobals();
});
