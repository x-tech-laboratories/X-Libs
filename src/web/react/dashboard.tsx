// Dashboards a person builds from the data sets an app offers: several named dashboards as tabs, each a `CardGrid` of
// chart cards worked out by `run_card` and ready-made cards the app draws itself, arranged once Arrange is on, with an
// editor that sets a chart card's data, period, conditions, grouping, measure and view over a live preview. The
// dashboards are plain data the app keeps and saves from `on_change`. A card that throws while drawing shows a failure
// in its own place through react-error-boundary, chosen because React still catches render errors only in a class.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import {
  card_problem, condition_ops, field_of_set, fitting_views, flat_filter, filter_of, known_values, measure_fields, new_chart_card, new_condition,
  offered_measures, op_takes_value, periods_needed, run_card, settle_card, since_of, time_buckets,
  type CardResult, type CardView, type ChartCard, type Dashboard, type DashboardCard, type DashboardPlace, type DataField, type DataRow, type DataSet,
  type FlatFilter, type Measure, type TimeBucket,
} from "../../dashboard.ts";
import type { DateUnit, LeafNode, RelativeDate } from "../../filter.ts";
import { format_count } from "../format.ts";
import { CardGrid, place_cards, type CardSize } from "./card_grid.tsx";
import { BarChart, Donut, LineChart, Meters, StackedBarChart, Treemap } from "./charts.tsx";
import { NumberField, Segmented, Select, Switch } from "./controls.tsx";
import { confirm_dialog, Dialog, open_dialog } from "./dialog.tsx";
import { AddIcon, Icon } from "./icons.tsx";
import { FormRow, Tabs } from "./layout.tsx";
import { MenuButton } from "./menu_button.tsx";
import { open_context_menu, type MenuItem } from "./menus.tsx";
import { use_phone } from "./phone.ts";
import { Empty, Failure, Skeleton, use_resource, type ResourceOptions } from "./states.tsx";
import { DataTable, type TableColumn } from "./table.tsx";

// ── Types ────────────────────────────────────────────────────────────────────

// A data set the page can load; `since` is the earliest moment any card needs, in milliseconds, or null for every row.
export interface DataSource extends DataSet {
  load: (options: { since: number | null }) => Promise<DataRow[]>;
}

// A card the app draws itself, offered ready-made in the Add card menu.
export interface ReadyCardKind {
  name: string;
  label: string;
  render: () => ReactNode;
  // Its size in grid cells when added, the grid's own unless given.
  default_size?: CardSize;
}

export interface DashboardsProps {
  // The dashboards shown; the app keeps them and saves each change.
  dashboards: Dashboard[];
  on_change: (dashboards: Dashboard[]) => void;
  // The dashboard shown, the first when null or unknown; the app keeps it, such as in its address.
  active: string | null;
  on_select: (id: string) => void;
  data_sources: DataSource[];
  ready_cards?: ReadyCardKind[];
  // When the data loads again quietly, such as every so often or when the app's live feed bumps a watch.
  refresh?: Pick<ResourceOptions, "refresh_in_milliseconds" | "watch">;
  // What the dashboard starts as when none is saved yet, and what Reset puts back; an empty one unless given.
  new_dashboard?: () => Dashboard;
  // A fixed width in pixels for the grid instead of the space it is given, such as in tests.
  width?: number;
}

// ── Choices ──────────────────────────────────────────────────────────────────

const chart_size: CardSize = { w: 4, h: 6 };
const grid_columns = 12;

const measure_names: Record<Measure, string> = {
  count: "Count of rows", sum: "Sum", average: "Average", min: "Lowest", max: "Highest", distinct: "Distinct count", latest: "Latest",
};

const view_names: Record<CardView, string> = {
  number: "Number", bars: "Bars", stacked_bars: "Stacked bars", line: "Line", donut: "Donut", meters: "Meters", treemap: "Treemap", table: "Table",
};

const bucket_names: Record<TimeBucket, string> = { hour: "Each hour", day: "Each day", week: "Each week", month: "Each month" };

const period_units = ["hour", "day", "week", "month", "year"] as const satisfies readonly DateUnit[];
const unit_names: Record<DateUnit, string> = { hour: "hours", day: "days", week: "weeks", month: "months", year: "years" };

const op_names: Record<string, string> = {
  is: "is", not_is: "is not", contains: "contains", starts: "starts with", ends: "ends with", empty: "is empty", defined: "is set",
  ">": "more than", "<": "less than", ">=": "at least", "<=": "at most", in_last: "in the last", not_in_last: "not in the last",
};

const new_id = (): string => crypto.randomUUID();

// ── Numbers and colours ──────────────────────────────────────────────────────

const plain_number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

// How a card's values read: whole numbers for counts, the measured field's own format where it has one, else up to two decimals.
export function value_format(card: ChartCard, data_set: DataSet): (value: number) => string {
  if (card.measure === "count" || card.measure === "distinct") return (value) => format_count(value);
  return field_of_set(data_set, card.measure_field)?.format ?? ((value) => plain_number.format(value));
}

// A group's or split's own colour, or Halon's chart series in turn.
export function series_color(own: string | null, index: number): string {
  return own ?? `var(--series-${(index % 6) + 1})`;
}

// What a card measures in words, such as "Average Seconds", a count going by what its data set holds, such as "Jobs".
export function measure_label(card: ChartCard, data_set: DataSet): string {
  if (card.measure === "count") return data_set.label;
  const field = field_of_set(data_set, card.measure_field)?.label ?? "";
  return card.measure === "distinct" ? `Distinct ${field}` : `${measure_names[card.measure]} ${field}`.trim();
}

// ── Dashboards ───────────────────────────────────────────────────────────────

// Several named dashboards as tabs, the one shown with its cards, and the buttons that add, rename, copy, reset and delete them.
export function Dashboards({ dashboards, on_change, active, on_select, data_sources, ready_cards = [], refresh, new_dashboard, width }: DashboardsProps) {
  const [arranging, set_arranging] = useState(false);
  const starter = useMemo(() => new_dashboard?.() ?? empty_dashboard("Dashboard"), [dashboards.length === 0]);
  const shown = dashboards.length > 0 ? dashboards : [starter];
  const current = shown.find((dashboard) => dashboard.id === active) ?? shown[0]!;
  // Dialogs opened from here outlive this render, so every change goes through the dashboards as they are when it is made.
  const latest = useRef({ shown, on_change });
  latest.current = { shown, on_change };
  const update_of = (id: string): Update => (change) =>
    latest.current.on_change(latest.current.shown.map((dashboard) => (dashboard.id === id ? change(dashboard) : dashboard)));
  const update = update_of(current.id);

  function add_dashboard(): void {
    const names = new Set(shown.map((dashboard) => dashboard.name));
    let count = shown.length + 1;
    while (names.has(`Dashboard ${count}`)) count += 1;
    const added = empty_dashboard(`Dashboard ${count}`);
    on_change([...shown, added]);
    on_select(added.id);
  }

  function duplicate_dashboard(): void {
    const copy = { ...current, id: new_id(), name: `${current.name} copy` };
    const at = shown.indexOf(current) + 1;
    on_change([...shown.slice(0, at), copy, ...shown.slice(at)]);
    on_select(copy.id);
  }

  function delete_dashboard(): void {
    confirm_dialog({
      title: "Delete dashboard?",
      message: `“${current.name}” and its cards will be deleted.`,
      confirm_label: "Delete",
      danger: true,
      run: async () => {
        const all = latest.current.shown;
        const at = all.findIndex((dashboard) => dashboard.id === current.id);
        const rest = all.filter((dashboard) => dashboard.id !== current.id);
        if (rest.length === 0) return;
        latest.current.on_change(rest);
        on_select(rest[Math.min(at, rest.length - 1)]!.id);
      },
    });
  }

  function reset_dashboard(): void {
    confirm_dialog({
      title: "Reset dashboard?",
      message: `“${current.name}” goes back to the cards it started with.`,
      confirm_label: "Reset",
      danger: true,
      run: async () => {
        const fresh = new_dashboard!();
        update((dashboard) => ({ ...dashboard, cards: fresh.cards, places: fresh.places }));
      },
    });
  }

  const dashboard_items: MenuItem[] = [
    { label: "New dashboard", run: add_dashboard },
    { label: "Rename…", run: () => open_dialog((close) => <NameDialog name={current.name} on_save={(name) => update((dashboard) => ({ ...dashboard, name }))} on_close={close} />) },
    { label: "Duplicate", run: duplicate_dashboard },
    ...(new_dashboard ? [{ label: "Reset…", run: reset_dashboard }] : []),
    { label: "Delete…", run: delete_dashboard, danger: true, disabled: shown.length <= 1, separator_before: true },
  ];

  return (
    <div className="stack tight">
      <div className="tab-row">
        <Tabs items={shown.map((dashboard) => ({ id: dashboard.id, label: dashboard.name }))} active={current.id} label="Dashboards" on_select={on_select} />
        <div className="panel-tools">
          {arranging && <AddCardButton dashboard={current} data_sources={data_sources} ready_cards={ready_cards} update={update} />}
          <button type="button" aria-pressed={arranging} onClick={() => set_arranging(!arranging)}>Arrange</button>
          <MenuButton label="Dashboard actions" items={dashboard_items} />
        </div>
      </div>
      <DashboardView
        key={current.id}
        dashboard={current}
        update={update}
        arranging={arranging}
        data_sources={data_sources}
        ready_cards={ready_cards}
        refresh={refresh}
        width={width}
      />
    </div>
  );
}

// A change to one dashboard, made to it as it is at the time.
type Update = (change: (dashboard: Dashboard) => Dashboard) => void;

function empty_dashboard(name: string): Dashboard {
  return { id: new_id(), name, cards: [], places: [] };
}

// A dashboard with one more card, placed under the others at the size given.
export function with_card(dashboard: Dashboard, card: DashboardCard, size: CardSize): Dashboard {
  const bottom = dashboard.places.reduce((lowest, place) => Math.max(lowest, place.y + place.h), 0);
  return { ...dashboard, cards: [...dashboard.cards, card], places: [...dashboard.places, { id: card.id, x: 0, y: bottom, w: size.w, h: size.h }] };
}

function AddCardButton({ dashboard, data_sources, ready_cards, update }: { dashboard: Dashboard; data_sources: DataSource[]; ready_cards: ReadyCardKind[]; update: Update }) {
  const [open, set_open] = useState(false);
  const shown_ready = new Set(dashboard.cards.flatMap((card) => (card.kind === "ready" ? [card.name] : [])));

  function new_chart(): void {
    const first = data_sources[0];
    if (!first) return;
    const card = new_chart_card(new_id(), first);
    open_dialog((close) => (
      <ChartCardEditor card={card} is_new data_sources={data_sources} on_save={(saved) => update((before) => with_card(before, saved, chart_size))} on_close={close} />
    ));
  }

  const items: MenuItem[] = [
    { label: "Chart…", run: new_chart, disabled: data_sources.length === 0 },
    ...ready_cards.filter((kind) => !shown_ready.has(kind.name)).map((kind, index) => ({
      label: kind.label,
      separator_before: index === 0,
      run: () => update((before) => with_card(before, { id: new_id(), kind: "ready", name: kind.name }, kind.default_size ?? chart_size)),
    })),
  ];

  function open_menu(event: MouseEvent<HTMLButtonElement>): void {
    const box = event.currentTarget.getBoundingClientRect();
    set_open(true);
    open_context_menu({ clientX: box.left, clientY: box.bottom, preventDefault: () => {} }, items, () => set_open(false));
  }

  return (
    <button type="button" className="accent" aria-haspopup="menu" aria-expanded={open} onClick={open_menu}>
      <Icon icon={AddIcon} /> Add card
    </button>
  );
}

// A dashboard's name typed into a small form.
function NameDialog({ name, on_save, on_close }: { name: string; on_save: (name: string) => void; on_close: () => void }) {
  const [typed, set_typed] = useState(name);
  return (
    <Dialog
      title="Rename dashboard"
      on_close={on_close}
      buttons={<button type="button" onClick={on_close}>Cancel</button>}
      form={{
        on_submit: () => { on_save(typed.trim()); on_close(); },
        submit_label: "Rename",
        submit_disabled: typed.trim() === "",
      }}
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input type="text" autoFocus value={typed} onChange={(event) => set_typed(event.currentTarget.value)} />
      </label>
    </Dialog>
  );
}

// ── One dashboard ────────────────────────────────────────────────────────────

interface LoadedData {
  now: number;
  outcomes: Record<string, { rows: DataRow[] } | { error: unknown }>;
}

interface DashboardViewProps {
  dashboard: Dashboard;
  update: Update;
  arranging: boolean;
  data_sources: DataSource[];
  ready_cards: ReadyCardKind[];
  refresh: DashboardsProps["refresh"];
  width: number | undefined;
}

function DashboardView({ dashboard, update, arranging, data_sources, ready_cards, refresh, width }: DashboardViewProps) {
  const phone = use_phone();
  const data = use_dashboard_data(dashboard.cards, data_sources, refresh);
  const by_id = new Map(dashboard.cards.map((card) => [card.id, card]));
  const order = place_cards(dashboard.cards.map((card) => card.id), dashboard.places, grid_columns, chart_size);

  const name_of = (card: DashboardCard): string =>
    card.kind === "ready" ? (ready_cards.find((kind) => kind.name === card.name)?.label ?? "Card") : card.title || "Untitled chart";

  const placed = (each: Dashboard) => place_cards(each.cards.map((card) => card.id), each.places, grid_columns, chart_size);
  const replace = (card: DashboardCard) => update((before) => ({ ...before, cards: before.cards.map((each) => (each.id === card.id ? card : each)) }));

  function remove(card: DashboardCard): void {
    update((before) => ({ ...before, cards: before.cards.filter((each) => each.id !== card.id), places: before.places.filter((place) => place.id !== card.id) }));
  }

  function duplicate(card: ChartCard): void {
    update((before) => {
      const places = placed(before);
      const copy: ChartCard = { ...card, id: new_id(), title: `${card.title} copy` };
      return with_card({ ...before, places }, copy, places.find((place) => place.id === card.id) ?? chart_size);
    });
  }

  // Swapping a card's corner with its neighbour's in reading order changes the order a phone lists them in.
  function move(card: DashboardCard, step: -1 | 1): void {
    update((before) => {
      const places = placed(before);
      const at = places.findIndex((place) => place.id === card.id);
      const [mine, other] = [places[at], places[at + step]];
      if (!mine || !other) return before;
      const swapped = places.map((place) =>
        place.id === mine.id ? { ...place, x: other.x, y: other.y } : place.id === other.id ? { ...place, x: mine.x, y: mine.y } : place,
      );
      return { ...before, places: place_cards(places.map((place) => place.id), swapped, grid_columns, chart_size) };
    });
  }

  function edit(card: ChartCard): void {
    open_dialog((close) => <ChartCardEditor card={card} data_sources={data_sources} on_save={replace} on_close={close} />);
  }

  function items_of(card: DashboardCard): MenuItem[] {
    const at = order.findIndex((place) => place.id === card.id);
    return [
      ...(card.kind === "chart" ? [{ label: "Edit…", run: () => edit(card) }] : []),
      ...(card.kind === "chart" ? [{ label: "Duplicate", run: () => duplicate(card) }] : []),
      ...(phone ? [
        { label: "Move up", run: () => move(card, -1), disabled: at <= 0 },
        { label: "Move down", run: () => move(card, 1), disabled: at >= order.length - 1 },
      ] : []),
      { label: "Remove", run: () => remove(card), danger: true, separator_before: card.kind === "chart" || phone },
    ];
  }

  if (dashboard.cards.length === 0) {
    return <Empty title="No cards yet" hint={arranging ? "Add a card to start." : "Choose Arrange, then Add card."} />;
  }

  return (
    <CardGrid
      items={order.map((place) => by_id.get(place.id)!)}
      id_of={(card) => card.id}
      name_of={name_of}
      label={dashboard.name}
      places={order}
      on_places_change={(places: DashboardPlace[]) => update((before) => ({ ...before, places }))}
      columns={grid_columns}
      default_size={chart_size}
      editable={arranging}
      width={width}
      render_card={(card) => (
        <CardFrame title={name_of(card)} items={arranging ? items_of(card) : null}>
          <ErrorBoundary resetKeys={[card, data.data]} fallbackRender={({ error, resetErrorBoundary }) => <Failure error={error} retry={resetErrorBoundary} />}>
            {card.kind === "ready" ? (
              <ReadyBody kind={ready_cards.find((kind) => kind.name === card.name)} />
            ) : (
              <LoadedChart card={card} data_set={data_sources.find((source) => source.id === card.data_set)} data={data} />
            )}
          </ErrorBoundary>
        </CardFrame>
      )}
    />
  );
}

// A ready-made card drawn by the app inside its card's error boundary.
function ReadyBody({ kind }: { kind: ReadyCardKind | undefined }) {
  return <>{kind ? kind.render() : <p className="muted">This card is no longer offered.</p>}</>;
}

// A card's title row with its menu while arranging, over its body.
function CardFrame({ title, items, children }: { title: string; items: MenuItem[] | null; children: ReactNode }) {
  return (
    <article className="dashboard-card" aria-label={title} onContextMenu={items ? (event) => open_context_menu(event, items) : undefined}>
      <div className="dashboard-card-head">
        <h3 className="dashboard-card-title" title={title}>{title}</h3>
        {items && <MenuButton label={`${title} actions`} items={items} />}
      </div>
      <div className="dashboard-card-body">{children}</div>
    </article>
  );
}

// Every data set the cards read, each loaded once from the earliest moment its cards need, and loaded again quietly on `refresh`.
function use_dashboard_data(cards: readonly DashboardCard[], data_sources: DataSource[], refresh: DashboardsProps["refresh"]) {
  const needed = periods_needed(cards);
  const key = JSON.stringify([...needed].sort(([first], [second]) => first.localeCompare(second)));
  return use_resource<LoadedData>(async () => {
    const now = Date.now();
    const entries = await Promise.all([...needed].map(async ([id, period]) => {
      const source = data_sources.find((each) => each.id === id);
      if (!source) return [id, { rows: [] }] as const;
      try {
        return [id, { rows: await source.load({ since: since_of(period, now) }) }] as const;
      } catch (error) {
        return [id, { error }] as const;
      }
    }));
    return { now, outcomes: Object.fromEntries(entries) };
  }, [key], refresh);
}

function LoadedChart({ card, data_set, data }: { card: ChartCard; data_set: DataSet | undefined; data: ReturnType<typeof use_dashboard_data> }) {
  const problem = card_problem(card, data_set);
  if (problem !== null) return <p className="muted">{problem}</p>;
  if (data.status !== "loaded" || data.data === null) return data.status === "failed" ? <Failure error={data.error} retry={() => void data.reload()} /> : <Skeleton />;
  const outcome = data.data.outcomes[card.data_set];
  if (!outcome) return <Skeleton />;
  if ("error" in outcome) return <Failure error={outcome.error} retry={() => void data.reload()} />;
  return <ChartView card={card} data_set={data_set!} rows={outcome.rows} now={data.data.now} />;
}

// ── Drawing a card ───────────────────────────────────────────────────────────

interface ChartViewProps {
  card: ChartCard;
  data_set: DataSet;
  rows: readonly DataRow[];
  now: number;
}

// A chart card worked out over its rows and drawn as its view.
export function ChartView({ card, data_set, rows, now }: ChartViewProps) {
  const result = useMemo(() => run_card(data_set, rows, card, now), [data_set, rows, card, now]);
  const format = value_format(card, data_set);
  const shown = (value: number | null) => (value === null ? "—" : format(value));
  const title = card.title || "Untitled chart";
  const measured = measure_label(card, data_set);

  if (card.view === "number") {
    return (
      <div className="dashboard-number" role="group" aria-label={title}>
        <span className="dashboard-number-value">{shown(result.total)}</span>
        <span className="tile-label">{measured}</span>
      </div>
    );
  }
  if (result.matching_rows === 0) return <Empty title="Nothing to show" hint="No rows match this card." />;

  const colored = result.groups.map((group, index) => ({ ...group, color: series_color(group.color, index) }));
  const splits = result.splits.map((split, index) => ({ ...split, color: series_color(split.color, index) }));
  const legend = splits.length > 0 && (
    <div className="share-legend" role="group" aria-label="Legend">
      {splits.map((split) => <span key={split.label} className="legend" style={{ "--swatch": split.color } as CSSProperties}>{split.label}</span>)}
    </div>
  );

  switch (card.view) {
    case "bars":
      return <BarChart title={title} bars={colored.map((group) => ({ label: group.label, value: group.value ?? 0, color: group.color }))} format={format} labels />;
    case "stacked_bars":
      return (
        <>
          <StackedBarChart
            title={title}
            legend={[]}
            format={format}
            stacks={result.groups.map((group) => ({ label: group.label, parts: group.parts.map((part, index) => ({ label: part.label, value: part.value ?? 0, color: splits[index]!.color })) }))}
          />
          {legend}
        </>
      );
    case "line": {
      const labels = new Map(result.groups.map((group) => [group.epoch, group.label]));
      const series = splits.length > 0
        ? splits.map((split, index) => ({ label: split.label, color: split.color, points: result.groups.map((group): [number, number | null] => [group.epoch ?? 0, group.parts[index]!.value]) }))
        : [{ label: measured, color: series_color(null, 0), points: result.groups.map((group): [number, number | null] => [group.epoch ?? 0, group.value]) }];
      return (
        <>
          <LineChart title={title} series={series} format={format} format_time={(epoch) => labels.get(epoch) ?? ""} empty_message="Not enough spans of time to draw a line." />
          {legend}
        </>
      );
    }
    case "donut":
      return (
        <Donut
          title={title}
          parts={colored.map((group) => ({ label: group.label, value: group.value ?? 0, color: group.color }))}
          center={shown(result.total)}
          center_label={measured}
          message="Nothing to show."
          format={format}
        />
      );
    case "meters":
      return <Meters rows={meter_rows(result, format)} message="Nothing to show." />;
    case "treemap":
      return <Treemap label={title} format={format} tiles={colored.map((group) => ({ name: group.label, value: group.value ?? 0, color: group.color, title: `${group.label}: ${shown(group.value)}` }))} />;
    case "table":
      return <ResultTable result={result} card={card} data_set={data_set} shown={shown} />;
  }
}

// Each group as a meter filled by its share of the largest group, which reads the same for every measure.
export function meter_rows(result: CardResult, format: (value: number) => string) {
  const top = Math.max(0, ...result.groups.map((group) => group.value ?? 0)) || 1;
  return result.groups.map((group, index) => ({
    label: group.label,
    href: null,
    value_text: group.value === null ? "—" : format(group.value),
    percent: Math.max(0, ((group.value ?? 0) / top) * 100),
    color: series_color(group.color, index),
    marks: [],
    title: null,
  }));
}

type ResultRow = CardResult["groups"][number];

function ResultTable({ result, card, data_set, shown }: { result: CardResult; card: ChartCard; data_set: DataSet; shown: (value: number | null) => string }) {
  const group_label = field_of_set(data_set, card.group_by)?.label ?? "Group";
  const value_column = (label: string, value: (row: ResultRow) => number | null): TableColumn<ResultRow> => ({
    label, cell: (row) => shown(value(row)), sort: value, text: (row) => shown(value(row)), class: "number", filterable: false, groupable: false,
  });
  const columns: TableColumn<ResultRow>[] = [
    { label: group_label, cell: (row) => row.label, sort: (row) => (typeof row.key === "number" ? row.key : row.label), filterable: false, groupable: false },
    ...(result.splits.length > 0
      ? result.splits.map((split, index) => value_column(split.label, (row) => row.parts[index]!.value))
      : [value_column(measure_label(card, data_set), (row) => row.value)]),
  ];
  return <DataTable columns={columns} rows={result.groups} row_key={(row) => String(row.key)} caption={card.title} column_hiding={false} />;
}

// ── Editor ───────────────────────────────────────────────────────────────────

interface ChartCardEditorProps {
  card: ChartCard;
  // Whether the card is new, which the dialog's title says.
  is_new?: boolean;
  data_sources: DataSource[];
  on_save: (card: ChartCard) => void;
  on_close: () => void;
}

const none = "";

// A chart card's settings as a form beside a live preview; Save hands the card back and Cancel drops the changes.
export function ChartCardEditor({ card, is_new = false, data_sources, on_save, on_close }: ChartCardEditorProps) {
  const [draft, set_draft] = useState(() => opened_card(card, data_sources));
  const data_set = data_sources.find((source) => source.id === draft.data_set);
  const [flat, set_flat] = useState<FlatFilter | null>(() => (data_set ? flat_filter(draft.filter, data_set) : null));

  if (!data_set) {
    return (
      <Dialog title="Chart" on_close={on_close} buttons={<button type="button" onClick={on_close}>Close</button>}>
        <p className="muted">This app offers no data to chart.</p>
      </Dialog>
    );
  }

  const update = (changes: Partial<ChartCard>) => set_draft((before) => settle_card({ ...before, ...changes }, data_set));
  const change_filter = (next: FlatFilter) => {
    set_flat(next);
    update({ filter: filter_of(next) });
  };

  function change_data_set(id: string): void {
    const source = data_sources.find((each) => each.id === id)!;
    const fresh = new_chart_card(draft.id, source);
    const title = draft.title === data_set!.label || draft.title === "" ? source.label : draft.title;
    set_draft(settle_card({ ...fresh, title, view: draft.view }, source));
    set_flat({ join: "and", conditions: [] });
  }

  const group_field = field_of_set(data_set, draft.group_by);
  const fields = measure_fields(data_set, draft.measure);
  const text_fields = data_set.fields.filter((field) => field.kind === "text" && field.id !== draft.group_by);
  const views = fitting_views(draft, data_set);
  const field_id = (name: string) => `dashboard-editor-${draft.id}-${name}`;

  return (
    <Dialog
      title={is_new ? "New chart" : "Edit chart"}
      wide
     
      on_close={on_close}
      buttons={<button type="button" onClick={on_close}>Cancel</button>}
      form={{ on_submit: () => { on_save(draft); on_close(); }, submit_label: "Save" }}
    >
      <div className="dashboard-editor">
        <div className="form-rows">
          <FormRow label="Title" id={field_id("title")}>
            <input id={field_id("title")} type="text" value={draft.title} onChange={(event) => update({ title: event.currentTarget.value })} />
          </FormRow>
          <FormRow label="Data" id={field_id("data")}>
            <Select id={field_id("data")} bare label="Data" options={data_sources.map((source): [string, string] => [source.id, source.label])} value={data_set.id} on_change={change_data_set} />
          </FormRow>
          {data_set.time_field !== undefined && <PeriodRow id={field_id("period")} period={draft.period} on_change={(period) => update({ period })} />}
          <FormRow label="Only rows where" id={field_id("filter")}>
            {flat ? (
              <ConditionList id={field_id("filter")} data_set={data_set} flat={flat} on_change={change_filter} />
            ) : (
              <div className="stack tight">
                <p className="muted" id={field_id("filter")}>This card's filter was set up elsewhere and cannot be changed here.</p>
                <div><button type="button" onClick={() => change_filter({ join: "and", conditions: [] })}>Clear filter</button></div>
              </div>
            )}
          </FormRow>
          <FormRow label="Group by" id={field_id("group")}>
            <div className="dashboard-editor-pair">
              <Select
                id={field_id("group")}
                bare
                label="Group by"
                options={[[none, "None"], ...data_set.fields.map((field): [string, string] => [field.id, field.label])]}
                value={draft.group_by ?? none}
                on_change={(value) => update({ group_by: value || null })}
              />
              {group_field?.kind === "time" && (
                <Select bare label="Span" options={time_buckets.map((bucket): [TimeBucket, string] => [bucket, bucket_names[bucket]])} value={draft.bucket ?? "day"} on_change={(bucket) => update({ bucket })} />
              )}
            </div>
          </FormRow>
          {group_field && (
            <FormRow label="Split by" id={field_id("split")}>
              <Select
                id={field_id("split")}
                bare
                label="Split by"
                options={[[none, "None"], ...text_fields.map((field): [string, string] => [field.id, field.label])]}
                value={draft.split_by ?? none}
                on_change={(value) => update({ split_by: value || null })}
              />
            </FormRow>
          )}
          <FormRow label="Measure" id={field_id("measure")}>
            <div className="dashboard-editor-pair">
              <Select
                id={field_id("measure")}
                bare
                label="Measure"
                options={offered_measures(data_set).map((measure): [Measure, string] => [measure, measure_names[measure]])}
                value={draft.measure}
                on_change={(measure) => update({ measure })}
              />
              {fields.length > 0 && (
                <Select bare label="Measured field" options={fields.map((field): [string, string] => [field.id, field.label])} value={draft.measure_field ?? fields[0]!.id} on_change={(measure_field) => update({ measure_field })} />
              )}
            </div>
          </FormRow>
          {group_field && (
            <FormRow label="Order" id={field_id("sort")}>
              <div className="dashboard-editor-pair">
                {group_field.kind !== "time" && (
                  <Select
                    id={field_id("sort")}
                    bare
                    label="Sort by"
                    options={[["group", `By ${group_field.label.toLowerCase()}`], ["value", "By value"]] as ["group" | "value", string][]}
                    value={draft.sort}
                    on_change={(sort) => update({ sort })}
                  />
                )}
                <Switch label={group_field.kind === "time" ? "Newest first" : "Descending"} show_label checked={draft.descending} on_change={(descending) => update({ descending })} />
              </div>
            </FormRow>
          )}
          {group_field && (
            <FormRow label="Show at most" id={field_id("limit")} hint="Every group when empty.">
              <NumberField bare label="Show at most" min={1} value={draft.limit} on_change={(limit) => update({ limit })} />
            </FormRow>
          )}
          <FormRow label="Show as" id={field_id("view")}>
            <Select id={field_id("view")} bare label="Show as" options={views.map((view): [CardView, string] => [view, view_names[view]])} value={draft.view} on_change={(view) => update({ view })} />
          </FormRow>
        </div>
        <section className="dashboard-preview" aria-label="Preview">
          <PreviewCard card={draft} data_set={data_set} />
        </section>
      </div>
    </Dialog>
  );
}

// "Any time", or the last so many hours, days, weeks, months or years.
// The card as the editor starts it: set straight for its data set, or started afresh on the first one when its own is gone.
function opened_card(card: ChartCard, data_sources: DataSource[]): ChartCard {
  const own = data_sources.find((source) => source.id === card.data_set);
  if (own) return settle_card(card, own);
  const first = data_sources[0];
  return first ? settle_card({ ...new_chart_card(card.id, first), title: card.title || first.label }, first) : card;
}

function PeriodRow({ id, period, on_change }: { id: string; period: RelativeDate | null; on_change: (period: RelativeDate | null) => void }) {
  const units = period_units.map((unit): [string, string] => [unit, period === null ? `Last ${unit_names[unit]}` : unit_names[unit]]);
  return (
    <FormRow label="Period" id={id}>
      <div className="dashboard-editor-pair">
        {period && <span className="muted">Last</span>}
        {period && <NumberField bare label="Period length" min={1} value={period.count} on_change={(count) => on_change({ ...period, count: count ?? 1 })} />}
        <Select
          id={id}
          bare
          label="Period"
          options={[[none, "Any time"], ...units]}
          value={period?.unit ?? none}
          on_change={(value) => on_change(value === none ? null : { count: period?.count ?? 7, unit: value as DateUnit })}
        />
      </div>
    </FormRow>
  );
}

function ConditionList({ id, data_set, flat, on_change }: { id: string; data_set: DataSet; flat: FlatFilter; on_change: (flat: FlatFilter) => void }) {
  const set_condition = (index: number, condition: LeafNode) => on_change({ ...flat, conditions: flat.conditions.map((each, at) => (at === index ? condition : each)) });
  return (
    <div className="dashboard-conditions" id={id} role="group" aria-label="Conditions">
      {flat.conditions.length > 1 && (
        <Segmented<"and" | "or"> label="Match" choices={[{ value: "and", label: "All of these" }, { value: "or", label: "Any of these" }]} value={flat.join} on_change={(join) => on_change({ ...flat, join })} />
      )}
      {flat.conditions.map((condition, index) => (
        <ConditionRow
          key={index}
          number={index + 1}
          data_set={data_set}
          condition={condition}
          on_change={(next) => set_condition(index, next)}
          on_remove={() => on_change({ ...flat, conditions: flat.conditions.filter((_, at) => at !== index) })}
        />
      ))}
      <div>
        <button type="button" onClick={() => on_change({ ...flat, conditions: [...flat.conditions, new_condition(data_set.fields[0]!)] })} disabled={data_set.fields.length === 0}>
          <Icon icon={AddIcon} /> Add condition
        </button>
      </div>
    </div>
  );
}

interface ConditionRowProps {
  number: number;
  data_set: DataSet;
  condition: LeafNode;
  on_change: (condition: LeafNode) => void;
  on_remove: () => void;
}

function ConditionRow({ number, data_set, condition, on_change, on_remove }: ConditionRowProps) {
  const field = field_of_set(data_set, condition.field)!;
  const name = `Condition ${number}`;

  function change_field(id: string): void {
    const next = field_of_set(data_set, id)!;
    on_change(next.kind === field.kind ? { ...condition, field: id, value: next.kind === "text" ? new_condition(next).value : condition.value } : new_condition(next));
  }

  function change_op(op: string): void {
    const { value, ...rest } = condition;
    if (!op_takes_value(op)) return on_change({ ...rest, op });
    on_change({ ...rest, op, value: value ?? new_condition(field).value });
  }

  return (
    <div className="dashboard-condition" role="group" aria-label={name}>
      <div className="dashboard-editor-pair">
        <Select bare label={`${name} field`} options={data_set.fields.map((each): [string, string] => [each.id, each.label])} value={field.id} on_change={change_field} />
        <Select bare label={`${name} test`} options={condition_ops[field.kind].map((op): [string, string] => [op, op_names[op] ?? op])} value={condition.op} on_change={change_op} />
        {op_takes_value(condition.op) && <ConditionValue name={name} field={field} condition={condition} on_change={on_change} />}
      </div>
      <button type="button" className="icon remove" aria-label={`Remove ${name.toLowerCase()}`} onClick={on_remove}>×</button>
    </div>
  );
}

function ConditionValue({ name, field, condition, on_change }: { name: string; field: DataField; condition: LeafNode; on_change: (condition: LeafNode) => void }) {
  const label = `${name} value`;
  if (field.kind === "time") {
    const span = (condition.value as RelativeDate | undefined) ?? { count: 7, unit: "day" };
    return (
      <>
        <NumberField bare label={label} min={1} value={span.count} on_change={(count) => on_change({ ...condition, value: { ...span, count: count ?? 1 } })} />
        <Select bare label={`${name} unit`} options={period_units.map((unit): [DateUnit, string] => [unit, unit_names[unit]])} value={span.unit} on_change={(unit) => on_change({ ...condition, value: { ...span, unit } })} />
      </>
    );
  }
  if (field.kind === "number") {
    return <NumberField bare label={label} value={typeof condition.value === "number" ? condition.value : null} on_change={(value) => on_change({ ...condition, value })} />;
  }
  const known = known_values(field);
  const text = typeof condition.value === "string" ? condition.value : "";
  if (known.length > 0 && (condition.op === "is" || condition.op === "not_is")) {
    const options = known.map((key): [string, string] => [key, field.value_labels?.[key] ?? key]);
    return <Select bare label={label} options={known.includes(text) ? options : [[text, text], ...options]} value={text} on_change={(value) => on_change({ ...condition, value })} />;
  }
  return <input type="text" aria-label={label} value={text} onChange={(event) => on_change({ ...condition, value: event.currentTarget.value })} />;
}

// The card being edited, drawn from its own load of its data set so the preview follows every change.
function PreviewCard({ card, data_set }: { card: ChartCard; data_set: DataSource }) {
  const data = use_resource(async () => {
    const now = Date.now();
    return { now, rows: await data_set.load({ since: since_of(card.period, now) }) };
  }, [data_set.id, JSON.stringify(card.period)]);
  const title = card.title || "Untitled chart";
  return (
    <CardFrame title={title} items={null}>
      <ErrorBoundary resetKeys={[card, data.data]} fallbackRender={({ error, resetErrorBoundary }) => <Failure error={error} retry={resetErrorBoundary} />}>
        {data.status === "failed" ? <Failure error={data.error} retry={() => void data.reload()} />
          : data.data === null ? <Skeleton />
            : card_problem(card, data_set) !== null ? <p className="muted">{card_problem(card, data_set)}</p>
              : <ChartView card={card} data_set={data_set} rows={data.data.rows} now={data.data.now} />}
      </ErrorBoundary>
    </CardFrame>
  );
}
