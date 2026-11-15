// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { FlowMap, layout, node_height, order_columns, reachable, type FlowColumn, type FlowLink } from "../src/web/react/flow_map.tsx";

afterEach(cleanup);

// Two flakes feed a cache, and the cache and one flake feed deployments on two hosts.
const columns: FlowColumn[] = [
  { title: "Flakes", nodes: [{ id: "flake:b", label: "b" }, { id: "flake:a", label: "a", tone: "ok", details: [{ text: "github:me/a", mono: true }] }] },
  { title: "Caches", nodes: [{ id: "cache:main", label: "main", tone: "warning", href: "#/caches/main" }] },
  {
    title: "Hosts",
    groups: [
      { id: "thor", label: "Thor", href: "#/hosts/thor", nodes: [{ id: "deployment:thor", label: "thor", tone: "critical" }] },
      { id: "odin", label: "Odin", nodes: [{ id: "deployment:odin", label: "odin", tone: "ok" }] },
    ],
  },
];
const links: FlowLink[] = [
  { from: "flake:a", to: "cache:main" },
  { from: "cache:main", to: "deployment:odin", tone: "warning" },
  { from: "flake:b", to: "deployment:thor", tone: "critical", title: "b builds thor" },
];

test("each column follows the order of the nodes its lines come from", () => {
  const given: FlowColumn[] = [
    { title: "Flakes", nodes: [{ id: "a", label: "a" }, { id: "b", label: "b" }] },
    { title: "Caches", nodes: [{ id: "from-b", label: "from-b" }, { id: "from-a", label: "from-a" }] },
    { title: "Hosts", groups: [{ id: "thor", label: "Thor", nodes: [{ id: "on-thor", label: "on-thor" }] }, { id: "odin", label: "Odin", nodes: [{ id: "on-odin", label: "on-odin" }] }] },
  ];
  const slots = order_columns(given, [{ from: "a", to: "from-a" }, { from: "b", to: "from-b" }, { from: "from-a", to: "on-odin" }, { from: "from-b", to: "on-thor" }]);

  // The cache fed by a moves up beside a, and Odin, fed by that cache, moves up beside it.
  expect(slots[1][0].nodes.map((node) => node.id)).toEqual(["from-a", "from-b"]);
  expect(slots[2].map((slot) => slot.group!.id)).toEqual(["odin", "thor"]);
  expect(slots[0][0].nodes.map((node) => node.id)).toEqual(["a", "b"]);
});

test("a node is as tall as its label and details, and groups wrap their nodes", () => {
  const placed = layout(columns, links);

  expect(node_height({ id: "x", label: "x" })).toBe(28);
  expect(node_height({ id: "x", label: "x", details: [{ text: "1" }, { text: "2" }] })).toBe(60);
  const odin = placed.groups.find(({ group }) => group.id === "odin")!.box;
  const deployment = placed.nodes.get("deployment:odin")!.box;
  expect(deployment.y).toBeGreaterThan(odin.y);
  expect(deployment.y + deployment.height).toBeLessThan(odin.y + odin.height);
  expect(placed.nodes.get("cache:main")!.box.x).toBeGreaterThan(placed.nodes.get("flake:a")!.box.x);
});

test("hovering lights what is upstream and downstream, not siblings", () => {
  expect([...reachable(links, "cache:main")].sort()).toEqual(["cache:main", "deployment:odin", "flake:a"]);
  expect([...reachable(links, "deployment:thor")].sort()).toEqual(["deployment:thor", "flake:b"]);
});

test("the map draws a line per link, links nodes and groups with pages, and lights a hovered path", () => {
  render(<FlowMap label="What builds what" columns={columns} links={links} legend={["ok", "warning"]} />);

  const map = screen.getByRole("img", { name: "What builds what" });
  expect(map.querySelectorAll("path.flow")).toHaveLength(3);
  expect(map.querySelector("path.flow-tone-critical title")!.textContent).toBe("b builds thor");
  expect(map.querySelector('a[href="#/caches/main"]')!.getAttribute("data-node")).toBe("cache:main");
  expect(map.querySelector('a[href="#/hosts/thor"]')!.textContent).toContain("Thor");
  expect([...document.querySelectorAll(".flow-map-legend .legend")].map((item) => item.textContent)).toEqual(["OK", "Warning"]);

  fireEvent.pointerOver(map.querySelector('[data-node="cache:main"] rect')!);
  expect(map.classList.contains("focused")).toBe(true);
  expect([...map.querySelectorAll(".flow-node.lit, g.flow-node.lit, a.lit")].map((item) => item.getAttribute("data-node")).sort()).toEqual(["cache:main", "deployment:odin", "flake:a"]);
  expect(map.querySelectorAll("path.flow.lit")).toHaveLength(2);
});
