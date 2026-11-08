// The pieces a page is laid out with: the page heading, panels, facts, tiles, cards, tabs, breadcrumbs, toolbars, steppers, settings rows and list row buttons.

import { Fragment, type MouseEvent, type ReactNode } from "react";
import type { Tone } from "./badges.tsx";

export { moved } from "../tables.ts";

// ── Heading ──────────────────────────────────────────────────────────────────

interface PageHeadingProps {
  title: ReactNode;
  // A muted line under the title, such as a count or a date.
  subtitle?: ReactNode;
  // A picture before the title, such as a channel's avatar.
  icon?: ReactNode;
  // A wide picture above the title, as a URL or an element of the app's own.
  banner?: string | ReactNode;
  // The page's buttons, on the title's right.
  actions?: ReactNode;
  class_name?: string;
  // The title's heading level, 1 for a page and 2 or 3 inside a dialog or panel.
  level?: 1 | 2 | 3;
  // What follows the title, such as a description or the page's tabs.
  children?: ReactNode;
}

// A page's heading: an optional banner, the title with its icon and subtitle, and the page's buttons.
export function PageHeading({ title, subtitle, icon, banner, actions, class_name, level = 1, children }: PageHeadingProps) {
  const Title = `h${level}` as const;
  return (
    <header className={class_name ? `page-head ${class_name}` : "page-head"}>
      {typeof banner === "string" ? <img className="page-banner" src={banner} alt="" loading="lazy" /> : banner}
      <div className="page-title spread">
        <div className="page-identity">
          {icon}
          <div>
            <Title>{title}</Title>
            {subtitle && <p className="page-subtitle muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="head-actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────

interface SectionProps {
  title: ReactNode;
  tools?: ReactNode;
  class_name?: string;
  on_context_menu?: (event: MouseEvent<HTMLElement>) => void;
  children?: ReactNode;
}

export function Section({ title, tools, class_name, on_context_menu, children }: SectionProps) {
  return (
    <section className={class_name ? `panel ${class_name}` : "panel"} onContextMenu={on_context_menu}>
      <div className="panel-head">
        <h2>{title}</h2>
        {tools && <div className="panel-tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

export type Fact = [label: string, value: ReactNode, class_name?: string];

// Labelled values in a grid of tiles, or as rows of label and value for long values such as paths.
export function Facts({ rows, layout = "grid" }: { rows: (Fact | null | false)[]; layout?: "grid" | "rows" }) {
  return (
    <dl className={layout === "rows" ? "facts facts-rows" : "facts"}>
      {rows.filter((row): row is Fact => Boolean(row)).map(([label, value, class_name]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={class_name}>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// A stack of panels or blocks spaced by its gap, tighter when tight.
export function Stack({ tight = false, children }: { tight?: boolean; children: ReactNode }) {
  return <div className={tight ? "stack tight" : "stack"}>{children}</div>;
}

// ── Tiles and cards ──────────────────────────────────────────────────────────

interface TileProps {
  label: string;
  value: ReactNode;
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
  const label_part = <div className="tile-label">{label}</div>;
  const value_part = <div className="tile-value">{value}</div>;
  const children = value_first ? <>{value_part}{label_part}</> : <>{label_part}{value_part}</>;
  return href ? <a className={tile_class} href={href}>{children}</a> : <div className={tile_class}>{children}</div>;
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>;
}

interface CardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  // A class such as tone-edge-bad that marks the card's edge.
  class_name?: string;
  href?: string;
  on_click?: () => void;
  children?: ReactNode;
}

// A titled card for one thing among many, laid out in a grid of Cards.
export function Card({ title, subtitle, badge, class_name, href, on_click, children }: CardProps) {
  const card_class = class_name ? `card ${class_name}` : "card";
  const body = (
    <>
      <div className="card-head"><strong>{title}</strong>{badge}</div>
      {subtitle && <div className="muted card-host">{subtitle}</div>}
      {children}
    </>
  );
  if (href) return <a className={card_class} href={href}>{body}</a>;
  if (on_click) return <button type="button" className={card_class} onClick={on_click}>{body}</button>;
  return <div className={card_class}>{body}</div>;
}

export function Cards({ children }: { children: ReactNode }) {
  return <div className="grid">{children}</div>;
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
    <nav className="tabs" aria-label={label}>
      {items.map((item) => {
        const tab_class = item.id === active ? "tab active" : "tab";
        const current = item.id === active ? "page" : undefined;
        return item.href
          ? <a key={item.id} className={tab_class} href={item.href} aria-current={current}>{item.label}</a>
          : <button key={item.id} type="button" className={tab_class} aria-current={current} onClick={() => on_select?.(item.id)}>{item.label}</button>;
      })}
    </nav>
  );
}

export function Crumbs({ items }: { items: [label: string, href: string | null][] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map(([label, href], index) => (
        <Fragment key={index}>
          {index > 0 && <span className="muted" aria-hidden="true"> / </span>}
          {href ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}

// ── Toolbars ─────────────────────────────────────────────────────────────────

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

interface Step {
  text: string;
  href: string | null;
}

// Steps to the item before or after this one, each a link or a dead button when there is none, with where this one stands between.
export function Stepper({ label, previous, position, next }: { label: string; previous: Step; position: ReactNode; next: Step }) {
  const step = (target: Step) => target.href === null
    ? <button disabled>{target.text}</button>
    : <a className="button" href={target.href}>{target.text}</a>;
  return <div className="stepper" role="group" aria-label={label}>{step(previous)}<span className="muted">{position}</span>{step(next)}</div>;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function SettingsGroup({ heading, hint, children }: { heading: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="settings-heading">{heading}</h3>
      {hint && <p className="setting-hint">{hint}</p>}
      {children}
    </section>
  );
}

// A setting's name and hint on one side and its control on the other; as a label, clicking anywhere works its one control.
export function SettingRow({ label, hint, as_label = false, class_name, children }: { label: ReactNode; hint?: ReactNode; as_label?: boolean; class_name?: string; children: ReactNode }) {
  const row_class = class_name ? `setting-row ${class_name}` : "setting-row";
  const text = (
    <span className="setting-text">
      <span className="setting-label">{label}</span>
      {hint && <span className="setting-hint">{hint}</span>}
    </span>
  );
  return as_label ? <label className={row_class}>{text}{children}</label> : <div className={row_class}>{text}{children}</div>;
}

interface RowActionsProps {
  index: number;
  count: number;
  on_move: (from: number, to: number) => void;
  on_remove?: () => void;
  // The remove button's name, such as "Remove Weekly".
  remove_label: string;
}

// The up, down and remove buttons of a row in an ordered list.
export function RowActions({ index, count, on_move, on_remove, remove_label }: RowActionsProps) {
  return (
    <span className="row-actions">
      <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => on_move(index, index - 1)}>↑</button>
      <button type="button" className="icon" aria-label="Move down" disabled={index === count - 1} onClick={() => on_move(index, index + 1)}>↓</button>
      {on_remove && <button type="button" className="icon danger" aria-label={remove_label} onClick={on_remove}>×</button>}
    </span>
  );
}

// ── Picked rows ──────────────────────────────────────────────────────────────

interface SelectionBarProps {
  // How many rows are picked, and how many are on screen to pick from.
  count: number;
  total: number;
  on_clear: () => void;
  on_select_all: () => void;
  // The actions for every picked row, such as Mark done and Delete.
  children: ReactNode;
}

// A bar floating at the foot of the page while rows are picked: how many, Select all, the actions, and a button that lets them go.
export function SelectionBar({ count, total, on_clear, on_select_all, children }: SelectionBarProps) {
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected rows">
      <button type="button" className="icon" aria-label="Clear selection" title="Clear selection (Esc)" onClick={on_clear}>✕</button>
      <span className="selection-count">{count} selected</span>
      {count < total && <button type="button" onClick={on_select_all}>Select all</button>}
      <span className="selection-divider" aria-hidden="true" />
      {children}
    </div>
  );
}
