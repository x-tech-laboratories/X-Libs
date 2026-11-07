// The pieces a page is laid out with: panels, facts, tiles, cards, tabs, breadcrumbs, toolbars, steppers and settings rows.

import { Fragment, type ComponentChildren } from "preact";
import type { Tone } from "./badges.tsx";

// ── Panels ───────────────────────────────────────────────────────────────────

export function Section({ title, tools, children }: { title: ComponentChildren; tools?: ComponentChildren; children?: ComponentChildren }) {
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

export type Fact = [label: string, value: ComponentChildren, class_name?: string];

// Labelled values in a grid of tiles, or as rows of label and value for long values such as paths.
export function Facts({ rows, layout = "grid" }: { rows: (Fact | null | false)[]; layout?: "grid" | "rows" }) {
  return (
    <dl class={layout === "rows" ? "facts facts-rows" : "facts"}>
      {rows.filter((row): row is Fact => Boolean(row)).map(([label, value, class_name]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd class={class_name}>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// A stack of panels or blocks spaced by its gap, tighter when tight.
export function Stack({ tight = false, children }: { tight?: boolean; children: ComponentChildren }) {
  return <div class={tight ? "stack tight" : "stack"}>{children}</div>;
}

// ── Tiles and cards ──────────────────────────────────────────────────────────

interface TileProps {
  label: string;
  value: ComponentChildren;
  // Marks the tile's edge, as does a class such as tone-edge-warn.
  tone?: Tone;
  class_name?: string | null;
  href?: string;
  // Puts the figure above its label rather than below it.
  value_first?: boolean;
}

// One headline figure and its label.
export function Tile({ label, value, tone, class_name, href, value_first = false }: TileProps) {
  const tile_class = ["tile", tone && tone !== "none" && `tile-${tone}`, class_name].filter(Boolean).join(" ");
  const label_part = <div class="tile-label">{label}</div>;
  const value_part = <div class="tile-value">{value}</div>;
  const children = value_first ? <>{value_part}{label_part}</> : <>{label_part}{value_part}</>;
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

// ── Navigation ───────────────────────────────────────────────────────────────

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  // A tab links to its page, or is chosen by on_select when it has no link.
  href?: string;
}

export function Tabs<Id extends string>({ items, active, label = "Sections", on_select }: { items: TabItem<Id>[]; active: Id; label?: string; on_select?: (id: Id) => void }) {
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

export function Crumbs({ items }: { items: [label: string, href: string | null][] }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      {items.map(([label, href], index) => (
        <Fragment key={index}>
          {index > 0 && <span class="muted" aria-hidden="true"> / </span>}
          {href ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}

// ── Toolbars ─────────────────────────────────────────────────────────────────

export function Toolbar({ children }: { children: ComponentChildren }) {
  return <div class="toolbar">{children}</div>;
}

interface Step {
  text: string;
  href: string | null;
}

// Steps to the item before or after this one, each a link or a dead button when there is none, with where this one stands between.
export function Stepper({ label, previous, position, next }: { label: string; previous: Step; position: ComponentChildren; next: Step }) {
  const step = (target: Step) => target.href === null
    ? <button disabled>{target.text}</button>
    : <a class="button" href={target.href}>{target.text}</a>;
  return <div class="stepper" role="group" aria-label={label}>{step(previous)}<span class="muted">{position}</span>{step(next)}</div>;
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

// A setting's name and hint on one side and its control on the other; as a label, clicking anywhere works its one control.
export function SettingRow({ label, hint, as_label = false, children }: { label: ComponentChildren; hint?: ComponentChildren; as_label?: boolean; children: ComponentChildren }) {
  const text = (
    <span class="setting-text">
      <span class="setting-label">{label}</span>
      {hint && <span class="setting-hint">{hint}</span>}
    </span>
  );
  return as_label ? <label class="setting-row">{text}{children}</label> : <div class="setting-row">{text}{children}</div>;
}
