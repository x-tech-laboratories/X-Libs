// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { BarChart, Donut, LineChart, Meters, moving_average, Sparkline, StackedBarChart, Strip, Timeline } from "../src/web/react/charts.tsx";

afterEach(cleanup);

const format = (value: number) => `${value} GB`;

// ════════════════════════════════════════════════════════════════════════════
// Line chart
// ════════════════════════════════════════════════════════════════════════════

test("a line chart draws one path per series and a dashed line per limit", () => {
  render(<LineChart title="Store used" format={format} series={[{ label: "thor", color: "red", points: [[0, 1], [60, 2]] }]} limits={[{ label: "Collect at", value: 5, color: "blue" }]} />);

  const chart = screen.getByRole("img", { name: "Store used" });
  expect(chart.querySelectorAll("path")).toHaveLength(1);
  expect(chart.querySelector("line[stroke-dasharray]")!.textContent).toBe("Collect at: 5 GB");
  expect(chart.closest("figure")!.querySelector(".legend")!.textContent).toBe("thor");
});

test("a line chart with one reading says there is not enough history", () => {
  render(<LineChart title="Store used" format={format} series={[{ label: "thor", color: "red", points: [[0, 1], [0, 2]] }]} />);

  expect(screen.getByText("Not enough history yet to draw a trend.")).toBeTruthy();
});

const day = 86400;
const kg = (value: number) => `${value} kg`;
const iso_date = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10);

function ticks(): string[] {
  return [...screen.getByRole("img").querySelectorAll("text.tick")].map((tick) => tick.textContent ?? "");
}

test("a trend chart draws readings as dots, their average as a line and a goal dashed, on a scale fitted to them", () => {
  const weights: [number, number][] = [[0, 80], [day, 81], [2 * day, 79]];
  render(
    <LineChart
      title="Weight"
      format={kg}
      scale="fit"
      format_time={iso_date}
      series={[
        { label: "Readings", color: "var(--series-1)", draw: "dots", points: weights },
        { label: "Average", color: "var(--series-2)", points: moving_average(weights, 7 * day) },
      ]}
      limits={[{ label: "Goal", value: 75, color: "var(--status-success)" }]}
    />,
  );

  const chart = screen.getByRole("img", { name: "Weight" });
  expect([...chart.querySelectorAll("circle title")].map((title) => title.textContent)).toEqual(["1970-01-01: 80 kg", "1970-01-02: 81 kg", "1970-01-03: 79 kg"]);
  expect(chart.querySelector("path title")!.textContent).toBe("Average");
  expect(chart.querySelector("line[stroke-dasharray] title")!.textContent).toBe("Goal: 75 kg");
  // 75 to 81 padded by 15% of the span either way, not down to zero.
  expect(ticks()).toEqual(["81.9 kg", "74.1 kg", "1970-01-01", "1970-01-03"]);
  expect([...chart.closest("figure")!.querySelectorAll(".legend")].map((legend) => legend.textContent)).toEqual(["Readings", "Average", "Goal"]);
});

test("a chart of dots draws a single reading in the middle, with one date and a made-up span", () => {
  render(<LineChart title="Weight" format={kg} scale="fit" format_time={iso_date} series={[{ label: "Readings", color: "red", draw: "dots", points: [[0, 80]] }]} />);

  const dot = screen.getByRole("img").querySelector("circle")!;
  expect(dot.getAttribute("cx")).toBe("328.0");
  expect(ticks()).toEqual(["84 kg", "76 kg", "1970-01-01"]);
});

test("a chart with nothing to draw says its own message", () => {
  render(<LineChart title="Weight" format={kg} empty_message="Nothing to plot yet." series={[{ label: "Readings", color: "red", draw: "dots", points: [] }]} />);

  expect(screen.getByText("Nothing to plot yet.")).toBeTruthy();
});

test("a moving average runs over the window ending on each reading, skipping gaps", () => {
  expect(moving_average([[0, 2], [day, null], [2 * day, 4], [10 * day, 9]], 7 * day)).toEqual([[0, 2], [2 * day, 3], [10 * day, 9]]);
});

// ════════════════════════════════════════════════════════════════════════════
// Bars
// ════════════════════════════════════════════════════════════════════════════

test("a bar chart draws a bar per value with its label and value as its title", () => {
  render(<BarChart title="Freed" format={format} bars={[{ label: "Monday", value: 2, color: "red" }, { label: "Tuesday", value: 4, color: "red" }]} />);

  const titles = [...screen.getByRole("img").querySelectorAll("rect title")].map((title) => title.textContent);
  expect(titles).toEqual(["Monday: 2 GB", "Tuesday: 4 GB"]);
});

test("stacked bars skip empty parts and say when nothing ran", () => {
  const { rerender } = render(<StackedBarChart title="Jobs" format={String} legend={[]} stacks={[{ label: "9:00", parts: [{ label: "ok", value: 2, color: "green" }, { label: "failed", value: 0, color: "red" }] }]} />);

  expect(screen.getByRole("img").querySelectorAll("rect")).toHaveLength(1);
  rerender(<StackedBarChart title="Jobs" format={String} legend={[]} stacks={[{ label: "9:00", parts: [] }]} />);
  expect(screen.getByText("Nothing ran in this period.")).toBeTruthy();
});

// ════════════════════════════════════════════════════════════════════════════
// Meters, donut, timeline, sparkline and strip
// ════════════════════════════════════════════════════════════════════════════

test("a meter fills to its percent, with its ticks and a link", () => {
  render(<Meters message="None" rows={[{ label: "thor", href: "#/thor", value_text: "62%", percent: 62, color: "red", marks: [80], title: null }]} />);

  const meter = screen.getByRole("meter", { name: "thor" });
  expect(meter.getAttribute("aria-valuenow")).toBe("62");
  expect((meter.querySelector(".meter-fill") as HTMLElement).style.width).toBe("62%");
  expect((meter.querySelector(".meter-mark") as HTMLElement).style.left).toBe("80%");
  expect(screen.getByRole("link", { name: "thor" }).getAttribute("href")).toBe("#/thor");
});

test("a donut draws its parts and their shares in its legend", () => {
  render(<Donut title="Hosts" center="4" center_label="hosts" message="None" parts={[{ label: "In sync", value: 3, color: "green" }, { label: "Behind", value: 1, color: "orange" }]} />);

  expect(screen.getByRole("img", { name: "Hosts: 4 hosts" }).querySelectorAll("g circle")).toHaveLength(2);
  expect(screen.getByText("3 · 75%")).toBeTruthy();
});

test("a timeline draws spans and ticks in their lanes", () => {
  render(<Timeline title="Jobs" from={0} to={86400} legend={[]} message="None" rows={[{ label: "thor", href: null, marks: [{ start: 100, end: 900, color: "green", title: "Build" }, { start: 2000, end: null, color: "red", title: "Reboot" }] }]} />);

  const marks = [...screen.getByRole("img").querySelectorAll("rect")];
  expect(marks.map((mark) => mark.getAttribute("height"))).toEqual(["10", "14"]);
});

test("a sparkline needs two readings to draw", () => {
  const { container, rerender } = render(<Sparkline label="Disk" points={[[0, 10]]} top={100} color="red" />);

  expect(container.querySelectorAll("path")).toHaveLength(0);
  rerender(<Sparkline label="Disk" points={[[0, 10], [60, 20]]} top={100} color="red" />);
  expect(container.querySelectorAll("path")).toHaveLength(2);
});

test("a fitted sparkline spreads a small change over its height, where one from zero stays flat", () => {
  const heights = (scale: "zero" | "fit") => {
    const { container, unmount } = render(<Sparkline label="Weight" points={[[0, 80], [60, 81]]} top={0} color="red" scale={scale} />);
    const line = container.querySelectorAll("path")[1]!.getAttribute("d")!;
    unmount();
    return [...line.matchAll(/,([\d.]+)/g)].map((match) => Number(match[1]));
  };

  const [from_zero_start, from_zero_end] = heights("zero");
  expect(from_zero_start! - from_zero_end!).toBeLessThan(1);
  const [fitted_start, fitted_end] = heights("fit");
  expect(fitted_start! - fitted_end!).toBeGreaterThan(20);
});

test("a strip colors each cell by its verdict", () => {
  const { container } = render(<Strip title="Builds" cells={[{ label: "1", ok: true }, { label: "2", ok: false }, { label: "3", ok: null }]} />);

  expect([...container.querySelectorAll(".cell")].map((cell) => cell.className)).toEqual(["cell cell-pass", "cell cell-fail", "cell cell-none"]);
});
