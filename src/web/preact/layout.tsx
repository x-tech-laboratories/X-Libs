// Preact layout pieces drawn like the page's own: panels, tiles, cards, tabs, badges, states and settings rows.

import type { ComponentChildren } from "preact";
import type { Tone } from "../badges.ts";

export type { Tone } from "../badges.ts";

// ── Panels ───────────────────────────────────────────────────────────────────

interface SectionProps {
  title: ComponentChildren;
  tools?: ComponentChildren;
  children: ComponentChildren;
}

export function Section({ title, tools, children }: SectionProps) {
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>{title}</h2>
        {tools && <div class="panel-tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

// Labelled values in a grid of tiles, or as rows of label and value for long values such as paths.
export function Facts({ rows, layout = "grid" }: { rows: [label: string, value: ComponentChildren][]; layout?: "grid" | "rows" }) {
  return (
    <dl class={layout === "rows" ? "facts facts-rows" : "facts"}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Tiles and cards ──────────────────────────────────────────────────────────

interface TileProps {
  label: string;
  value: ComponentChildren;
  tone?: Tone;
  href?: string;
}

// One headline figure under its label, its edge marked by its tone.
export function Tile({ label, value, tone, href }: TileProps) {
  const tile_class = tone && tone !== "none" ? `tile tile-${tone}` : "tile";
  const children = <><div class="tile-label">{label}</div><div class="tile-value">{value}</div></>;
  return href ? <a class={tile_class} href={href}>{children}</a> : <div class={tile_class}>{children}</div>;
}

export function Tiles({ children }: { children: ComponentChildren }) {
  return <div class="tiles">{children}</div>;
}

interface CardProps {
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  badge?: ComponentChildren;
  // A class such as tone-edge-bad that marks the card's edge.
  class_name?: string;
  href?: string;
  on_click?: () => void;
  children?: ComponentChildren;
}

// A titled card for one thing among many, laid out in a grid of Cards.
export function Card({ title, subtitle, badge, class_name, href, on_click, children }: CardProps) {
  const card_class = class_name ? `card ${class_name}` : "card";
  const body = (
    <>
      <div class="card-head"><strong>{title}</strong>{badge}</div>
      {subtitle && <div class="muted card-host">{subtitle}</div>}
      {children}
    </>
  );
  if (href) return <a class={card_class} href={href}>{body}</a>;
  if (on_click) return <button type="button" class={card_class} onClick={on_click}>{body}</button>;
  return <div class={card_class}>{body}</div>;
}

export function Cards({ children }: { children: ComponentChildren }) {
  return <div class="grid">{children}</div>;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

interface TabsProps<Id extends string> {
  // Each tab either links to its page or is chosen by on_select.
  items: { id: Id; label: string; href?: string }[];
  active: Id;
  label?: string;
  on_select?: (id: Id) => void;
}

export function Tabs<Id extends string>({ items, active, label = "Sections", on_select }: TabsProps<Id>) {
  return (
    <nav class="tabs" aria-label={label}>
      {items.map((item) => {
        const tab_class = item.id === active ? "tab active" : "tab";
        const current = item.id === active ? "page" : undefined;
        return item.href
          ? <a key={item.id} class={tab_class} href={item.href} aria-current={current}>{item.label}</a>
          : <button key={item.id} type="button" class={tab_class} aria-current={current} onClick={() => on_select?.(item.id)}>{item.label}</button>;
      })}
    </nav>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

export function Badge({ tone = "none", title, children }: { tone?: Tone; title?: string; children: ComponentChildren }) {
  return <span class={`badge tone-${tone}`} title={title}>{children}</span>;
}

export function Chip({ title, on_click, children }: { title?: string; on_click?: () => void; children: ComponentChildren }) {
  return on_click
    ? <button type="button" class="chip" title={title} onClick={on_click}>{children}</button>
    : <span class="chip" title={title}>{children}</span>;
}

// ── States ───────────────────────────────────────────────────────────────────

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div class="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => <div key={index} class="skeleton-line" style={{ width: `${90 - index * 15}%` }} />)}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: ComponentChildren }) {
  return (
    <div class="empty">
      <p class="empty-title">{title}</p>
      {hint && <p class="muted">{hint}</p>}
    </div>
  );
}

export function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div class="failure" role="alert">
      <p>Could not load this: {error instanceof Error ? error.message : String(error)}</p>
      <button onClick={retry}>Retry</button>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function SettingsGroup({ heading, hint, children }: { heading: string; hint?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="settings-group">
      <h3 class="settings-heading">{heading}</h3>
      {hint && <p class="setting-hint">{hint}</p>}
      {children}
    </section>
  );
}

interface SettingRowProps {
  label: ComponentChildren;
  hint?: ComponentChildren;
  // Wraps the row in a label, so clicking anywhere on it works its one control, such as a switch.
  as_label?: boolean;
  children: ComponentChildren;
}

// A setting's name and hint on one side and its control on the other.
export function SettingRow({ label, hint, as_label = false, children }: SettingRowProps) {
  const text = (
    <span class="setting-text">
      <span class="setting-label">{label}</span>
      {hint && <span class="setting-hint">{hint}</span>}
    </span>
  );
  return as_label
    ? <label class="setting-row">{text}{children}</label>
    : <div class="setting-row">{text}{children}</div>;
}
