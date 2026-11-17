// An outcome log: what happened to each item of a run, such as each file of a scan or each row of an import, filtered by outcome and following the newest as they arrive.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "../dom.ts";
import { StateBadge, type Tone } from "./badges.tsx";
import { Segmented } from "./controls.tsx";
import { FollowToggle, at_bottom } from "./following.tsx";
import { Empty } from "./states.tsx";
import { DataTable, type TableColumn } from "./table.tsx";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OutcomeLogLabels {
  // The filter's names, the outcome labels following the All choice.
  filter: string;
  all: string;
  outcome: string;
  item: string;
  detail: string;
  empty: string;
}

const DEFAULT_LABELS: OutcomeLogLabels = { filter: "Show", all: "All", outcome: "Outcome", item: "Item", detail: "Detail", empty: "Nothing yet" };

interface OutcomeLogProps<Entry, Outcome extends string> {
  // The table's caption for screen readers, such as "Scanned files".
  label: string;
  entries: Entry[];
  outcome_of: (entry: Entry) => Outcome;
  // Each outcome's text and tone, in the order the filter lists them.
  outcomes: Record<Outcome, [text: string, tone: Tone]>;
  // What the entry is about, such as a file's path.
  item_of: (entry: Entry) => string;
  // Why it came out so, such as an error's message.
  detail_of?: (entry: Entry) => string | null | undefined;
  // Whether entries are still arriving, which is when the log follows the newest.
  active?: boolean;
  // The outcome shown, or null for all; the log keeps its own when not given.
  filter?: Outcome | null;
  on_filter_change?: (filter: Outcome | null) => void;
  // The height of a row in pixels, since only the rows in view are drawn.
  row_height?: number;
  // Classes for the table's scrolling box, which needs a height; Halon's following-output gives it one.
  wrap_class?: string;
  labels?: Partial<OutcomeLogLabels>;
}

interface Line<Entry> {
  entry: Entry;
  index: number;
}

const ALL = "all";
// The outcome column's width in pixels, room for a badge such as "Unchanged".
const OUTCOME_WIDTH = 128;
const choice_of = (outcome: string) => `outcome ${outcome}`;

// ── Log ──────────────────────────────────────────────────────────────────────

export function OutcomeLog<Entry, Outcome extends string>({
  label, entries, outcome_of, outcomes, item_of, detail_of, active = false, filter: own_filter, on_filter_change, row_height = 32,
  wrap_class = "following-output", labels: own_labels,
}: OutcomeLogProps<Entry, Outcome>) {
  const labels = { ...DEFAULT_LABELS, ...own_labels };
  const [kept_filter, set_kept_filter] = useState<Outcome | null>(null);
  const filter = own_filter === undefined ? kept_filter : own_filter;
  const [following, set_following] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const tally = useMemo(() => {
    const counts = new Map<Outcome, number>();
    for (const entry of entries) counts.set(outcome_of(entry), (counts.get(outcome_of(entry)) ?? 0) + 1);
    return counts;
  }, [entries]);

  const lines = useMemo(
    () => entries.map((entry, index) => ({ entry, index })).filter((line) => filter === null || outcome_of(line.entry) === filter),
    [entries, filter],
  );

  const order = Object.keys(outcomes) as Outcome[];
  const choices = [
    { value: ALL, label: `${labels.all} ${entries.length.toLocaleString()}` },
    ...order.filter((outcome) => (tally.get(outcome) ?? 0) > 0 || outcome === filter)
      .map((outcome) => ({ value: choice_of(outcome), label: `${outcomes[outcome][0]} ${(tally.get(outcome) ?? 0).toLocaleString()}` })),
  ];

  function choose(value: string): void {
    const next = value === ALL ? null : order.find((outcome) => choice_of(outcome) === value) ?? null;
    set_kept_filter(next);
    on_filter_change?.(next);
  }

  // ── Following ──

  const scroll_box = () => box.current?.querySelector<HTMLElement>(".table-wrap") ?? null;

  useLayoutEffect(() => {
    const element = scroll_box();
    if (following && active && element) element.scrollTop = element.scrollHeight;
  }, [lines.length, following, active]);

  useEffect(() => {
    const element = scroll_box();
    if (!element || !active) return;
    // Scrolling up stops following and scrolling back to the end resumes it.
    const on_scroll = () => set_following(at_bottom(element));
    element.addEventListener("scroll", on_scroll);
    return () => element.removeEventListener("scroll", on_scroll);
  }, [active, entries.length > 0]);

  // ── Columns ──

  const columns: TableColumn<Line<Entry>>[] = [
    {
      id: "outcome", label: labels.outcome, sortable: false, groupable: false, filterable: false, width: OUTCOME_WIDTH,
      cell: (line) => <StateBadge labels={outcomes} state={outcome_of(line.entry)} />,
      text: (line) => outcomes[outcome_of(line.entry)][0],
    },
    {
      id: "item", label: labels.item, sortable: false, groupable: false,
      cell: (line) => <span className="path" title={item_of(line.entry)}>{item_of(line.entry)}</span>,
      text: (line) => item_of(line.entry),
    },
  ];
  if (detail_of) {
    columns.push({
      id: "detail", label: labels.detail, sortable: false, groupable: false,
      cell: (line) => <span className="muted" title={detail_of(line.entry) ?? undefined}>{detail_of(line.entry) ?? ""}</span>,
      text: (line) => detail_of(line.entry) ?? "",
    });
  }

  if (entries.length === 0) return <Empty title={labels.empty} />;

  return (
    <div ref={box} className="following">
      <div className="following-tools">
        <Segmented label={labels.filter} choices={choices} value={filter === null ? ALL : choice_of(filter)} on_change={choose} />
        <FollowToggle following={following} on_change={set_following} disabled={!active} />
      </div>
      <DataTable
        caption={label} columns={columns} rows={lines} row_key={(line) => line.index} virtual={{ row_height }} wrap_class={cx("fit", wrap_class)}
        single_line column_hiding={false} fill_last_column
      />
    </div>
  );
}
