import { describe, expect, it } from "vitest";

import {
  bucket_start, card_problem, clean_dashboards, fitting_views, matching_rows, measure_rows, milliseconds_of, new_chart_card, next_bucket, run_card,
  type ChartCard, type DataRow, type DataSet,
} from "../src/dashboard.ts";
import { leaf } from "../src/filter.ts";

const at = (day: number, hour = 12): number => new Date(2026, 10, day, hour).getTime();
const now = at(10, 15);

const jobs: DataSet = {
  id: "jobs",
  label: "Jobs",
  time_field: "started",
  fields: [
    { id: "host", label: "Host", kind: "text" },
    { id: "state", label: "State", kind: "text", order: ["succeeded", "failed"], value_labels: { succeeded: "Succeeded" }, colors: { failed: "red" } },
    { id: "seconds", label: "Seconds", kind: "number" },
    { id: "started", label: "Started", kind: "time", clock: "seconds" },
  ],
};

const job = (host: string | null, state: string, seconds: number | null, started: number): DataRow => ({ host, state, seconds, started: started / 1000 });

const rows: DataRow[] = [
  job("odin", "succeeded", 30, at(8)),
  job("odin", "failed", 90, at(9)),
  job("thor", "succeeded", 60, at(9, 13)),
  job("thor", "succeeded", null, at(10, 9)),
  job(null, "failed", 10, at(2)),
];

const card = (changes: Partial<ChartCard> = {}): ChartCard => ({ ...new_chart_card("card", jobs), ...changes });
const values_of = (changes: Partial<ChartCard>) => run_card(jobs, rows, card(changes), now).groups.map((group) => [group.label, group.value]);

describe("a card's rows", () => {
  it("keeps every row with no filter or period, and only those both let through otherwise", () => {
    expect(matching_rows(jobs, rows, card(), now)).toHaveLength(5);
    expect(matching_rows(jobs, rows, card({ filter: leaf("state", "is", "failed") }), now)).toHaveLength(2);
    expect(matching_rows(jobs, rows, card({ filter: leaf("state", "is", "failed"), period: { count: 3, unit: "day" } }), now)).toHaveLength(1);
  });

  it("ranks the highest values over all the rows", () => {
    expect(matching_rows(jobs, rows, card({ filter: leaf("seconds", "top", 2) }), now).map((row) => row.seconds)).toEqual([90, 60]);
  });
});

describe("a measure", () => {
  it("counts rows, and sums, averages and bounds a field's numbers", () => {
    expect(measure_rows(jobs, rows, "count", null)).toBe(5);
    expect(measure_rows(jobs, rows, "sum", "seconds")).toBe(190);
    expect(measure_rows(jobs, rows, "average", "seconds")).toBe(47.5);
    expect(measure_rows(jobs, rows, "min", "seconds")).toBe(10);
    expect(measure_rows(jobs, rows, "max", "seconds")).toBe(90);
    expect(measure_rows(jobs, rows, "distinct", "host")).toBe(2);
  });

  it("takes the latest row's number that has one", () => {
    expect(measure_rows(jobs, rows, "latest", "seconds")).toBe(60);
    expect(measure_rows({ ...jobs, time_field: undefined }, rows, "latest", "seconds")).toBeNull();
  });

  it("gives zero for a sum of nothing and null for the rest, or with no field", () => {
    expect(measure_rows(jobs, [], "sum", "seconds")).toBe(0);
    expect(measure_rows(jobs, [], "average", "seconds")).toBeNull();
    expect(measure_rows(jobs, [], "latest", "seconds")).toBeNull();
    expect(measure_rows(jobs, rows, "sum", null)).toBeNull();
  });
});

describe("a card worked out", () => {
  it("gives only the total when nothing is grouped", () => {
    const result = run_card(jobs, rows, card({ measure: "sum", measure_field: "seconds" }), now);

    expect(result).toEqual({ groups: [], splits: [], total: 190, matching_rows: 5 });
  });

  it("groups by a text field in its own order, then by name, with the rows that have none last", () => {
    expect(values_of({ group_by: "state" })).toEqual([["Succeeded", 3], ["failed", 2]]);
    expect(values_of({ group_by: "host" })).toEqual([["odin", 2], ["thor", 2], ["None", 1]]);
  });

  it("carries a value's color", () => {
    expect(run_card(jobs, rows, card({ group_by: "state" }), now).groups.map((group) => group.color)).toEqual([null, "red"]);
  });

  it("sorts by value, turns the order around and keeps the first groups up to the limit", () => {
    expect(values_of({ group_by: "host", measure: "sum", measure_field: "seconds", sort: "value" })).toEqual([["None", 10], ["thor", 60], ["odin", 120]]);
    expect(values_of({ group_by: "host", measure: "sum", measure_field: "seconds", sort: "value", descending: true, limit: 1 })).toEqual([["odin", 120]]);
  });

  it("splits every group by a second field, each part in the splits' order", () => {
    const result = run_card(jobs, rows, card({ group_by: "host", split_by: "state" }), now);

    expect(result.splits.map((split) => split.label)).toEqual(["Succeeded", "failed"]);
    expect(result.groups.map((group) => group.parts.map((part) => part.value))).toEqual([[1, 1], [2, 0], [0, 1]]);
  });

  it("groups by days from the first row through the last, the empty days included", () => {
    const result = run_card(jobs, rows, card({ group_by: "started", bucket: "day", filter: leaf("host", "defined") }), now);

    expect(result.groups.map((group) => group.value)).toEqual([1, 2, 1]);
    expect(result.groups[0]!.epoch).toBe(at(8, 0) / 1000);
  });

  it("covers a period's every span through now", () => {
    const result = run_card(jobs, rows, card({ group_by: "started", bucket: "day", period: { count: 4, unit: "day" } }), now);

    expect(result.groups.map((group) => group.value)).toEqual([0, 0, 1, 2, 1]);
    expect(run_card(jobs, [], card({ group_by: "started", bucket: "hour" }), now).groups).toEqual([]);
  });

  it("puts the newest span first when descending", () => {
    expect(run_card(jobs, rows, card({ group_by: "started", bucket: "month", descending: true }), now).groups.map((group) => group.value)).toEqual([5]);
    expect(run_card(jobs, rows, card({ group_by: "started", bucket: "week", descending: true }), now).groups.map((group) => group.value)).toEqual([3, 2]);
  });
});

describe("time", () => {
  it("reads seconds, milliseconds and ISO dates, and nothing from an empty value", () => {
    expect(milliseconds_of(5, "seconds")).toBe(5000);
    expect(milliseconds_of(5)).toBe(5);
    expect(milliseconds_of("2026-11-10T00:00:00Z", "iso")).toBe(Date.UTC(2026, 10, 10));
    expect(milliseconds_of(null)).toBeNull();
    expect(milliseconds_of("soon", "iso")).toBeNull();
  });

  it("starts weeks on Monday and months on the first, and steps to the next span", () => {
    expect(bucket_start(at(10, 15), "hour")).toBe(at(10, 15));
    expect(bucket_start(at(10, 15), "week")).toBe(at(9, 0));
    expect(bucket_start(at(10, 15), "month")).toBe(at(1, 0));
    expect(next_bucket(at(9, 0), "week")).toBe(at(16, 0));
    expect(next_bucket(at(1, 0), "month")).toBe(new Date(2026, 11, 1).getTime());
    expect(next_bucket(at(1, 0), "hour")).toBe(at(1, 1));
  });
});

describe("what a card can show", () => {
  it("offers the views that fit its grouping", () => {
    expect(fitting_views(card(), jobs)).toEqual(["number"]);
    expect(fitting_views(card({ group_by: "host" }), jobs)).toContain("donut");
    expect(fitting_views(card({ group_by: "started" }), jobs)).toContain("line");
    expect(fitting_views(card({ group_by: "host", split_by: "state" }), jobs)).toEqual(["stacked_bars", "table"]);
    expect(fitting_views(card({ group_by: "started", split_by: "state" }), jobs)).toContain("line");
  });

  it("says why a card cannot be worked out", () => {
    const timeless = { ...jobs, time_field: undefined };

    expect(card_problem(card(), jobs)).toBeNull();
    expect(card_problem(card(), undefined)).toMatch(/no longer offered/);
    expect(card_problem(card({ group_by: "owner" }), jobs)).toMatch(/group field/);
    expect(card_problem(card({ filter: { op: "and", children: [leaf("owner", "is", "x")] } }), jobs)).toMatch(/filters by/);
    expect(card_problem(card({ measure: "sum" }), jobs)).toMatch(/Pick the field/);
    expect(card_problem(card({ measure: "latest", measure_field: "seconds" }), timeless)).toMatch(/latest/);
    expect(card_problem(card({ period: { count: 1, unit: "day" } }), timeless)).toMatch(/period/);
  });
});

describe("saved dashboards", () => {
  it("come back as they were saved", () => {
    const saved = [{ id: "main", name: "Main", cards: [card({ filter: { op: "not", children: [leaf("state", "is", "failed")] }, period: { count: 7, unit: "day" } }), { id: "map", kind: "ready", name: "map" }], places: [{ id: "map", x: 0, y: 0, w: 4, h: 4 }] }];

    expect(clean_dashboards(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("leave out what is not a dashboard, card or place", () => {
    const cleaned = clean_dashboards([
      "nonsense",
      { name: "No id" },
      { id: "main", cards: [{ id: "a", kind: "chart" }, { id: "b", kind: "ready" }, { id: "c", kind: "ready", name: "map" }, { id: "c", kind: "ready", name: "again" }, 5], places: [{ id: "gone", x: 0, y: 0, w: 1, h: 1 }, { id: "c", x: -1, y: 0, w: 1, h: 1 }, { id: "c", x: 1, y: 0, w: 1, h: 1 }] },
      { id: "main", name: "Twice" },
    ]);

    expect(cleaned).toEqual([{ id: "main", name: "Dashboard", cards: [{ id: "c", kind: "ready", name: "map" }], places: [{ id: "c", x: 1, y: 0, w: 1, h: 1 }] }]);
    expect(clean_dashboards({})).toEqual([]);
  });

  it("put a card's unknown choices back to the plain ones and drop a filter that is not one", () => {
    const [dashboard] = clean_dashboards([{ id: "main", name: "Main", cards: [{ id: "a", kind: "chart", data_set: "jobs", measure: "median", view: "pie", bucket: "decade", sort: "up", limit: 0, period: { count: -1, unit: "day" }, filter: { op: "xor", children: [] } }] }]);

    expect(dashboard!.cards[0]).toEqual({ ...card({ id: "a", title: "" }), bucket: "day" });
  });

  it("refuse a filter that is too deep, has a value of no known shape, or a not of several", () => {
    const with_filter = (filter: unknown) => (clean_dashboards([{ id: "main", cards: [{ id: "a", kind: "chart", data_set: "jobs", filter }] }])[0]!.cards[0] as ChartCard).filter;
    let deep: unknown = leaf("state", "is", "failed");
    for (let depth = 0; depth < 10; depth++) deep = { op: "and", children: [deep] };

    expect(with_filter(deep)).toBeNull();
    expect(with_filter({ field: "state", op: "is", value: { nested: true } })).toBeNull();
    expect(with_filter({ op: "not", children: [leaf("state", "empty"), leaf("host", "empty")] })).toBeNull();
    expect(with_filter({ field: "state", op: "contains", value: "FAIL", case_sensitive: true })).toEqual({ field: "state", op: "contains", value: "FAIL", case_sensitive: true });
    expect(with_filter({ field: "host", op: "any", value: ["odin", "thor"] })).toEqual(leaf("host", "any", ["odin", "thor"]));
  });
});
