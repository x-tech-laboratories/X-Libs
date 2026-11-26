// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { new_chart_card, type ChartCard, type Dashboard, type DataRow } from "../src/dashboard.ts";
import { leaf } from "../src/filter.ts";
import { ChartCardEditor, ChartView, Dashboards, meter_rows, series_color, value_format, with_card, type DataSource, type DashboardsProps, type ReadyCardKind } from "../src/web/react/dashboard.tsx";
import { Dialogs } from "../src/web/react/dialog.tsx";
import { ContextMenus } from "../src/web/react/menus.tsx";

const at = (day: number, hour = 12): number => new Date(2026, 10, day, hour).getTime();
const now = at(10, 15);

const rows: DataRow[] = [
  { host: "odin", state: "succeeded", seconds: 30, started: at(8) / 1000 },
  { host: "odin", state: "failed", seconds: 90, started: at(9) / 1000 },
  { host: "thor", state: "succeeded", seconds: 60, started: at(9, 13) / 1000 },
  { host: "thor", state: "succeeded", seconds: null, started: at(10, 9) / 1000 },
];

function jobs_source(load: DataSource["load"] = async () => rows): DataSource {
  return {
    id: "jobs",
    label: "Jobs",
    time_field: "started",
    load: vi.fn(load),
    fields: [
      { id: "host", label: "Host", kind: "text" },
      { id: "state", label: "State", kind: "text", order: ["succeeded", "failed"], value_labels: { succeeded: "Succeeded", failed: "Failed" }, colors: { failed: "var(--status-danger)" } },
      { id: "seconds", label: "Seconds", kind: "number", format: (value) => `${value} s` },
      { id: "started", label: "Started", kind: "time", clock: "seconds" },
    ],
  };
}

const chart = (changes: Partial<ChartCard> = {}): ChartCard => ({ ...new_chart_card("card", jobs_source()), title: "Jobs", ...changes });
const board = (id: string, name: string, cards: Dashboard["cards"] = []): Dashboard => ({ id, name, cards, places: [] });

const host_map: ReadyCardKind = { name: "map", label: "Host map", render: () => <p>The map of hosts</p> };

interface PageProps extends Partial<DashboardsProps> {
  start: Dashboard[];
  saved?: (dashboards: Dashboard[]) => void;
}

function Page({ start, saved, ...rest }: PageProps) {
  const [dashboards, set_dashboards] = useState(start);
  const [active, set_active] = useState<string | null>(null);
  return (
    <>
      <Dashboards
        dashboards={dashboards}
        on_change={(next) => { set_dashboards(next); saved?.(next); }}
        active={active}
        on_select={set_active}
        data_sources={[jobs_source()]}
        ready_cards={[host_map]}
        width={1200}
        {...rest}
      />
      <ContextMenus />
      <Dialogs />
    </>
  );
}

function pick_menu_item(opener: HTMLElement, name: string): void {
  fireEvent.click(opener);
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name }));
}

const choose = (label: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } });
const options_of = (label: string) => within(screen.getByRole("combobox", { name: label })).getAllByRole("option").map((option) => option.textContent);

let phone = false;
const plain_match_media = window.matchMedia;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  phone = false;
  window.matchMedia = ((query: string) => ({ matches: phone, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = plain_match_media;
});

// ============================================================================
// Dashboards
// ============================================================================

describe("dashboards", () => {
  it("shows each as a tab, the chosen one current, with its own cards", async () => {
    render(<Page start={[board("main", "Main", [{ id: "map", kind: "ready", name: "map" }]), board("other", "Other")]} />);

    const tabs = screen.getByRole("navigation", { name: "Dashboards" });
    expect(within(tabs).getByRole("button", { name: "Main" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("The map of hosts")).toBeTruthy();

    fireEvent.click(within(tabs).getByRole("button", { name: "Other" }));
    expect(within(tabs).getByRole("button", { name: "Other" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("The map of hosts")).toBeNull();
    expect(screen.getByText("No cards yet")).toBeTruthy();
  });

  it("adds, renames, duplicates and deletes a dashboard, and never deletes the last", async () => {
    const saved = vi.fn();
    render(<Page start={[board("main", "Main")]} saved={saved} />);
    const actions = () => screen.getByRole("button", { name: "Dashboard actions" });

    fireEvent.click(actions());
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete…" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    pick_menu_item(actions(), "New dashboard");
    expect(screen.getByRole("button", { name: "Dashboard 2" }).getAttribute("aria-current")).toBe("page");

    pick_menu_item(actions(), "Rename…");
    const dialog = screen.getByRole("dialog", { name: "Rename dashboard" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "  Hosts " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("button", { name: "Hosts" })).toBeTruthy();

    pick_menu_item(actions(), "Duplicate");
    expect(screen.getByRole("button", { name: "Hosts copy" }).getAttribute("aria-current")).toBe("page");

    pick_menu_item(actions(), "Delete…");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete dashboard?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Hosts copy" })).toBeNull());
    expect(saved).toHaveBeenLastCalledWith([expect.objectContaining({ name: "Main" }), expect.objectContaining({ name: "Hosts" })]);
    expect(screen.getByRole("button", { name: "Hosts" }).getAttribute("aria-current")).toBe("page");
  });

  it("starts from the app's dashboard when none is saved, and resets back to it", async () => {
    const saved = vi.fn();
    const starter = () => board("start", "Overview", [{ id: "map", kind: "ready", name: "map" }]);
    render(<Page start={[]} saved={saved} new_dashboard={starter} />);

    expect(screen.getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("The map of hosts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
    pick_menu_item(screen.getByRole("button", { name: "Host map actions" }), "Remove");
    expect(saved).toHaveBeenLastCalledWith([expect.objectContaining({ id: "start", cards: [] })]);

    pick_menu_item(screen.getByRole("button", { name: "Dashboard actions" }), "Reset…");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Reset dashboard?" })).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByText("The map of hosts")).toBeTruthy());
  });

  it("starts from an empty dashboard when the app gives none", () => {
    render(<Page start={[]} />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Reset…" })).toBeNull();
  });
});

// ============================================================================
// Arranging and adding cards
// ============================================================================

describe("arranging", () => {
  it("shows no handles, menus or Add card until Arrange is on", () => {
    render(<Page start={[board("main", "Main", [{ id: "map", kind: "ready", name: "map" }])]} />);

    expect(screen.queryByRole("button", { name: "Add card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Host map actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Host map" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
    expect(screen.getByRole("button", { name: "Arrange" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Add card" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Host map actions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move Host map" })).toBeTruthy();
  });

  it("adds a ready-made card once, and offers it again after it is removed", () => {
    const saved = vi.fn();
    render(<Page start={[board("main", "Main")]} saved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));

    pick_menu_item(screen.getByRole("button", { name: "Add card" }), "Host map");
    expect(screen.getByText("The map of hosts")).toBeTruthy();
    const [dashboard] = saved.mock.lastCall![0] as Dashboard[];
    expect(dashboard!.cards).toEqual([{ id: expect.any(String), kind: "ready", name: "map" }]);
    expect(dashboard!.places).toEqual([{ id: dashboard!.cards[0]!.id, x: 0, y: 0, w: 4, h: 6 }]);

    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Host map" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    pick_menu_item(screen.getByRole("button", { name: "Host map actions" }), "Remove");
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Host map" })).toBeTruthy();
  });

  it("adds a chart from the editor, and edits and duplicates it from its menu", async () => {
    const saved = vi.fn();
    render(<Page start={[board("main", "Main")]} saved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));

    pick_menu_item(screen.getByRole("button", { name: "Add card" }), "Chart…");
    const dialog = screen.getByRole("dialog", { name: "New chart" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), { target: { value: "Busy hosts" } });
    choose("Group by", "host");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("img", { name: "Busy hosts" })).toBeTruthy();
    const card = (saved.mock.lastCall![0] as Dashboard[])[0]!.cards[0] as ChartCard;
    expect(card).toMatchObject({ kind: "chart", title: "Busy hosts", data_set: "jobs", group_by: "host", view: "bars", measure: "count" });

    pick_menu_item(screen.getByRole("button", { name: "Busy hosts actions" }), "Edit…");
    choose("Show as", "donut");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Edit chart" })).getByRole("button", { name: "Save" }));
    expect(((saved.mock.lastCall![0] as Dashboard[])[0]!.cards[0] as ChartCard).view).toBe("donut");

    pick_menu_item(screen.getByRole("button", { name: "Busy hosts actions" }), "Duplicate");
    expect(screen.getByRole("button", { name: "Busy hosts copy actions" })).toBeTruthy();
    expect((saved.mock.lastCall![0] as Dashboard[])[0]!.places).toHaveLength(2);
  });

  it("works a card's menu and its handle from the keyboard", () => {
    const saved = vi.fn();
    render(<Page start={[board("main", "Main", [{ id: "map", kind: "ready", name: "map" }])]} saved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Host map" }), { key: "ArrowRight" });
    expect((saved.mock.lastCall![0] as Dashboard[])[0]!.places).toEqual([{ id: "map", x: 1, y: 0, w: 4, h: 6 }]);

    fireEvent.click(screen.getByRole("button", { name: "Host map actions" }));
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Remove" }));
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(screen.getByText("No cards yet")).toBeTruthy();
  });

  it("moves a card up and down from its menu on a phone, where nothing drags", () => {
    phone = true;
    const saved = vi.fn();
    const cards: Dashboard["cards"] = [{ id: "map", kind: "ready", name: "map" }, { id: "list", kind: "ready", name: "list" }];
    const host_list: ReadyCardKind = { name: "list", label: "Host list", render: () => <p>The list of hosts</p> };
    render(<Page start={[{ ...board("main", "Main", cards), places: [{ id: "map", x: 0, y: 0, w: 4, h: 6 }, { id: "list", x: 0, y: 6, w: 4, h: 3 }] }]} saved={saved} ready_cards={[host_map, host_list]} />);
    const order = () => within(screen.getByRole("list", { name: "Main" })).getAllByRole("article").map((card) => card.getAttribute("aria-label"));

    expect(order()).toEqual(["Host map", "Host list"]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Host map actions" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move up" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move down" }));

    expect(order()).toEqual(["Host list", "Host map"]);
    expect((saved.mock.lastCall![0] as Dashboard[])[0]!.places).toEqual([{ id: "list", x: 0, y: 0, w: 4, h: 3 }, { id: "map", x: 0, y: 3, w: 4, h: 6 }]);

    pick_menu_item(screen.getByRole("button", { name: "Host map actions" }), "Move up");
    expect(order()).toEqual(["Host map", "Host list"]);
  });
});

// ============================================================================
// Loading
// ============================================================================

describe("loading", () => {
  it("loads a data set once for all its cards, from the longest period they need, and draws every card from it", async () => {
    const source = jobs_source();
    const cards = [chart({ id: "a", title: "Last day", period: { count: 1, unit: "day" } }), chart({ id: "b", title: "Last three days", period: { count: 3, unit: "day" } })];
    render(<Page start={[board("main", "Main", cards)]} data_sources={[source]} />);

    expect(await screen.findAllByText("Rows")).toHaveLength(2);
    expect(source.load).toHaveBeenCalledTimes(1);
    expect(source.load).toHaveBeenCalledWith({ since: now - 3 * 86_400_000 });
    expect(within(screen.getByRole("group", { name: "Last day" })).getByText("1")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Last three days" })).getByText("4")).toBeTruthy();
  });

  it("loads every row when one card has no period", async () => {
    const source = jobs_source();
    render(<Page start={[board("main", "Main", [chart({ id: "a", period: { count: 1, unit: "day" } }), chart({ id: "b" })])]} data_sources={[source]} />);
    await screen.findAllByText("Rows");
    expect(source.load).toHaveBeenCalledWith({ since: null });
  });

  it("shows a failed load in the cards that read it, with Retry, and the others still drawn", async () => {
    let fail = true;
    const source = jobs_source(async () => {
      if (fail) throw new Error("the daemon is down");
      return rows;
    });
    render(<Page start={[board("main", "Main", [chart({ id: "a", title: "Count" }), { id: "map", kind: "ready", name: "map" }])]} data_sources={[source]} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("the daemon is down");
    expect(screen.getByText("The map of hosts")).toBeTruthy();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("4")).toBeTruthy();
  });

  it("keeps a card that throws in its own place", async () => {
    const broken: ReadyCardKind = { name: "broken", label: "Broken", render: () => { throw new Error("no map today"); } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Page start={[board("main", "Main", [{ id: "y", kind: "ready", name: "broken" }, { id: "map", kind: "ready", name: "map" }])]} ready_cards={[host_map, broken]} />);

    expect(screen.getByRole("alert").textContent).toContain("no map today");
    expect(screen.getByText("The map of hosts")).toBeTruthy();
    vi.mocked(console.error).mockRestore();
  });

  it("says why a card cannot be worked out, and when a ready card is no longer offered", async () => {
    render(<Page start={[board("main", "Main", [chart({ id: "a", group_by: "gone", view: "bars" }), chart({ id: "b", data_set: "gone" }), { id: "c", kind: "ready", name: "old" }])]} />);
    expect(screen.getByText("This card's group field is no longer offered.")).toBeTruthy();
    expect(screen.getByText("This card's data is no longer offered.")).toBeTruthy();
    expect(screen.getByText("This card is no longer offered.")).toBeTruthy();
  });
});

// ============================================================================
// Drawing
// ============================================================================

describe("a chart card", () => {
  const draw = (changes: Partial<ChartCard>, shown_rows = rows) => render(<ChartView card={chart(changes)} data_set={jobs_source()} rows={shown_rows} now={now} />);

  it("shows the total as a number in the measured field's format", () => {
    draw({ measure: "sum", measure_field: "seconds" });
    expect(screen.getByText("180 s")).toBeTruthy();
    expect(screen.getByText("Sum Seconds")).toBeTruthy();
    cleanup();
    draw({ measure: "average", measure_field: "seconds", filter: leaf("host", "is", "nobody") });
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("says when no rows match, outside the number view", () => {
    draw({ group_by: "host", view: "bars", filter: leaf("host", "is", "nobody") });
    expect(screen.getByText("Nothing to show")).toBeTruthy();
  });

  it("draws bars, a donut with the total in the middle, and a treemap", () => {
    draw({ group_by: "host", view: "bars" });
    expect(screen.getByRole("img", { name: "Jobs" })).toBeTruthy();
    cleanup();

    draw({ group_by: "state", view: "donut" });
    expect(screen.getByRole("img", { name: "Jobs: 4 Rows" })).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    cleanup();

    draw({ group_by: "host", view: "treemap", measure: "sum", measure_field: "seconds" });
    const map = screen.getByRole("group", { name: "Jobs" });
    expect(within(map).getAllByRole("button").map((tile) => tile.textContent)).toEqual(["odin120 s", "thor60 s"]);
  });

  it("draws stacked bars and lines with a legend of the splits", () => {
    const legend = () => within(screen.getByRole("group", { name: "Legend" })).getAllByText(/./).map((entry) => entry.textContent);
    draw({ group_by: "host", split_by: "state", view: "stacked_bars" });
    expect(screen.getByRole("img", { name: "Jobs, 4 in all" })).toBeTruthy();
    expect(legend()).toEqual(["Succeeded", "Failed"]);
    cleanup();

    draw({ group_by: "started", bucket: "day", split_by: "state", view: "line" });
    expect(screen.getByRole("img", { name: "Jobs" })).toBeTruthy();
    expect(legend()).toEqual(["Succeeded", "Failed"]);
    cleanup();

    draw({ group_by: "started", bucket: "day", view: "line" });
    expect(screen.getByRole("img", { name: "Jobs" })).toBeTruthy();
  });

  it("draws meters as shares of the largest group", () => {
    draw({ group_by: "host", view: "meters", measure: "sum", measure_field: "seconds" });
    expect(screen.getAllByRole("meter").map((meter) => [meter.getAttribute("aria-label"), meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuetext")])).toEqual([
      ["odin", "100", "120 s"],
      ["thor", "50", "60 s"],
    ]);
  });

  it("draws a table with a column per split", () => {
    draw({ group_by: "host", split_by: "state", view: "table" });
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(expect.arrayContaining(["Host", "Succeeded", "Failed"]));
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    cleanup();

    draw({ group_by: "host", view: "table", measure: "max", measure_field: "seconds" });
    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(expect.arrayContaining(["Highest Seconds"]));
  });

  it("formats counts as whole numbers and colours by a value's own colour or the series in turn", () => {
    expect(value_format(chart({ measure: "distinct", measure_field: "seconds" }), jobs_source())(1234)).toBe("1,234");
    expect(value_format(chart({ measure: "average", measure_field: "host" }), jobs_source())(1.256)).toBe((1.26).toLocaleString());
    expect([series_color("red", 0), series_color(null, 0), series_color(null, 7)]).toEqual(["red", "var(--series-1)", "var(--series-2)"]);
    expect(meter_rows({ groups: [], splits: [], total: null, matching_rows: 0 }, String)).toEqual([]);
  });

  it("places an added card under the others", () => {
    const dashboard = { ...board("main", "Main", []), places: [{ id: "a", x: 0, y: 0, w: 4, h: 5 }] };
    expect(with_card(dashboard, { id: "b", kind: "ready", name: "map" }, { w: 6, h: 2 }).places.at(-1)).toEqual({ id: "b", x: 0, y: 5, w: 6, h: 2 });
  });
});

// ============================================================================
// Editor
// ============================================================================

describe("the chart editor", () => {
  function edit(card: ChartCard, sources: DataSource[] = [jobs_source()]) {
    const on_save = vi.fn();
    const on_close = vi.fn();
    render(<ChartCardEditor card={card} data_sources={sources} on_save={on_save} on_close={on_close} />);
    const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
    return { on_save, on_close, save };
  }

  it("builds a filter from condition rows joined by all or any of them", async () => {
    const { on_save, save } = edit(chart());
    const add = () => fireEvent.click(screen.getByRole("button", { name: "Add condition" }));

    add();
    expect(screen.queryByRole("radiogroup", { name: "Match" })).toBeNull();
    choose("Condition 1 field", "seconds");
    expect(options_of("Condition 1 test")).toEqual(["is", "is not", "more than", "less than", "at least", "at most", "is empty", "is set"]);
    choose("Condition 1 test", ">");
    const value = screen.getByRole("textbox", { name: "Condition 1 value" });
    fireEvent.change(value, { target: { value: "45" } });
    fireEvent.blur(value);

    add();
    choose("Condition 2 field", "state");
    expect(options_of("Condition 2 value")).toEqual(["Succeeded", "Failed"]);
    choose("Condition 2 value", "failed");
    add();
    choose("Condition 3 field", "started");
    expect(options_of("Condition 3 test")).toEqual(["in the last", "not in the last", "is empty", "is set"]);
    choose("Condition 3 unit", "week");
    choose("Condition 3 test", "defined");
    expect(screen.queryByRole("combobox", { name: "Condition 3 unit" })).toBeNull();
    add();
    choose("Condition 4 field", "host");
    choose("Condition 4 test", "contains");
    fireEvent.change(screen.getByRole("textbox", { name: "Condition 4 value" }), { target: { value: "od" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove condition 3" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Match" })).getByRole("radio", { name: "Any of these" }));

    save();
    expect(on_save.mock.lastCall![0].filter).toEqual({ op: "or", children: [leaf("seconds", ">", 45), leaf("state", "is", "failed"), leaf("host", "contains", "od")] });
  });

  it("asks for a span when grouping by time and offers only the views that fit", () => {
    const { on_save, save } = edit(chart());
    expect(options_of("Show as")).toEqual(["Number"]);
    expect(screen.queryByRole("combobox", { name: "Split by" })).toBeNull();

    choose("Group by", "started");
    expect(options_of("Span")).toEqual(["Each hour", "Each day", "Each week", "Each month"]);
    choose("Span", "week");
    expect(options_of("Show as")).toEqual(["Bars", "Line", "Table"]);
    expect(screen.queryByRole("combobox", { name: "Sort by" })).toBeNull();
    choose("Show as", "line");

    choose("Split by", "state");
    expect(options_of("Show as")).toEqual(["Stacked bars", "Line", "Table"]);
    expect((screen.getByRole("combobox", { name: "Show as" }) as HTMLSelectElement).value).toBe("line");

    choose("Group by", "host");
    expect(options_of("Split by")).toEqual(["None", "State"]);
    expect((screen.getByRole("combobox", { name: "Show as" }) as HTMLSelectElement).value).toBe("stacked_bars");
    choose("Split by", "");
    choose("Show as", "meters");
    choose("Sort by", "value");
    fireEvent.click(screen.getByRole("switch", { name: "Descending" }));
    const limit = screen.getByRole("textbox", { name: "Show at most" });
    fireEvent.change(limit, { target: { value: "3" } });
    fireEvent.blur(limit);

    save();
    expect(on_save.mock.lastCall![0]).toMatchObject({ group_by: "host", bucket: null, split_by: null, sort: "value", descending: true, limit: 3, view: "meters" });
  });

  it("picks a measure's field among those that fit, and none for a count", () => {
    const { on_save, save } = edit(chart());
    expect(screen.queryByRole("combobox", { name: "Measured field" })).toBeNull();
    expect(options_of("Measure")).toEqual(["Count of rows", "Sum", "Average", "Lowest", "Highest", "Distinct count", "Latest"]);

    choose("Measure", "average");
    expect(options_of("Measured field")).toEqual(["Seconds"]);
    choose("Measure", "distinct");
    expect(options_of("Measured field")).toEqual(["Host", "State", "Seconds", "Started"]);
    choose("Measured field", "host");

    save();
    expect(on_save.mock.lastCall![0]).toMatchObject({ measure: "distinct", measure_field: "host" });
  });

  it("sets a period of the last so many hours to years, only for data with a time", () => {
    const { on_save, save } = edit(chart());
    choose("Period", "day");
    const length = screen.getByRole("textbox", { name: "Period length" });
    fireEvent.change(length, { target: { value: "3" } });
    fireEvent.blur(length);
    save();
    expect(on_save.mock.lastCall![0].period).toEqual({ count: 3, unit: "day" });
    cleanup();

    const timeless: DataSource = { ...jobs_source(), id: "hosts", label: "Hosts", time_field: undefined };
    edit({ ...new_chart_card("card", timeless) }, [timeless]);
    expect(screen.queryByRole("combobox", { name: "Period" })).toBeNull();
    expect(options_of("Measure")).not.toContain("Latest");
  });

  it("shows a live preview of the card as it is set up", async () => {
    edit(chart({ title: "Jobs" }));
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(await within(preview).findByText("4")).toBeTruthy();
    choose("Measure", "sum");
    expect(within(preview).getByText("180 s")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Seconds" } });
    expect(within(preview).getByRole("heading", { name: "Seconds" })).toBeTruthy();
  });

  it("starts a card on another data set afresh, keeping a title of its own", () => {
    const hosts: DataSource = { id: "hosts", label: "Hosts", load: async () => [], fields: [{ id: "name", label: "Name", kind: "text" }] };
    const { on_save, save } = edit(chart({ title: "Jobs", group_by: "host", view: "bars" }), [jobs_source(), hosts]);
    choose("Data", "hosts");
    expect(screen.queryByRole("combobox", { name: "Period" })).toBeNull();
    save();
    expect(on_save.mock.lastCall![0]).toMatchObject({ data_set: "hosts", title: "Hosts", group_by: null, view: "number" });
  });

  it("leaves a filter it cannot show as written until it is cleared", () => {
    const nested = { op: "and" as const, children: [{ op: "or" as const, children: [leaf("host", "is", "odin"), leaf("host", "is", "thor")] }] };
    const { on_save, save } = edit(chart({ filter: nested }));
    expect(screen.getByText("This card's filter was set up elsewhere and cannot be changed here.")).toBeTruthy();
    save();
    expect(on_save.mock.lastCall![0].filter).toEqual(nested);

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByRole("button", { name: "Add condition" })).toBeTruthy();
    save();
    expect(on_save.mock.lastCall![0].filter).toBeNull();
  });

  it("drops the changes on Cancel or Escape", () => {
    const { on_save, on_close } = edit(chart());
    choose("Group by", "host");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(on_close).toHaveBeenCalled();
    expect(on_save).not.toHaveBeenCalled();
  });

  it("starts a card whose data set is gone afresh on the first one offered", () => {
    const { on_save, save } = edit(chart({ data_set: "gone", title: "Old", group_by: "host", view: "bars" }));
    save();
    expect(on_save.mock.lastCall![0]).toMatchObject({ data_set: "jobs", title: "Old", group_by: null, view: "number" });
  });

  it("says when the app offers no data to chart", () => {
    edit(chart(), []);
    expect(screen.getByText("This app offers no data to chart.")).toBeTruthy();
  });
});
