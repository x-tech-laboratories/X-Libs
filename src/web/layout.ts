// The pieces a page is laid out with: panels, facts, tiles, cards, tabs, breadcrumbs, toolbars and steppers.

import { h, type Child } from "./dom.ts";

// ── Panels ───────────────────────────────────────────────────────────────────

export function section(title: Child, body: Child, tools: Child = null): HTMLElement {
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, title), tools && h("div", { class: "panel-tools" }, tools)),
    body);
}

// Labelled values in a grid of tiles, or as rows of label and value for long values such as paths.
export function facts(rows: [label: string, value: Child, class_name?: string][], layout: "grid" | "rows" = "grid"): HTMLElement {
  return h("dl", { class: layout === "rows" ? "facts facts-rows" : "facts" }, ...rows.map(([label, value, class_name]) => h("div", {},
    h("dt", {}, label), h("dd", { class: class_name ?? null }, value ?? "—"),
  )));
}

// ── Tiles and cards ──────────────────────────────────────────────────────────

// One headline figure under its label; a class such as tile-bad or tone-edge-warn marks its edge, and a link makes it open a page.
export function tile(label: string, value: Child, class_name: string | null = null, href: string | null = null): HTMLElement {
  const tile_class = `tile${class_name ? ` ${class_name}` : ""}`;
  const children = [h("div", { class: "tile-label" }, label), h("div", { class: "tile-value" }, value)];
  return href === null ? h("div", { class: tile_class }, ...children) : h("a", { class: tile_class, href }, ...children);
}

export function tiles(...items: Child[]): HTMLElement {
  return h("div", { class: "tiles" }, ...items);
}

export interface CardOptions {
  // A line under the title, such as where the thing lives.
  subtitle?: Child;
  // What the card's title stands beside, such as its status badge.
  badge?: Child;
  // A class such as tone-edge-bad that marks the card's edge.
  class_name?: string;
  // Makes the whole card a link to the thing's page.
  href?: string;
}

// A titled card for one thing among many, laid out in a grid.
export function card(title: Child, body: Child, options: CardOptions = {}): HTMLElement {
  const card_class = `card${options.class_name ? ` ${options.class_name}` : ""}`;
  const children = [
    h("div", { class: "card-head" }, h("strong", {}, title), options.badge),
    options.subtitle && h("div", { class: "muted card-host" }, options.subtitle),
    body,
  ];
  return options.href ? h("a", { class: card_class, href: options.href }, ...children) : h("div", { class: card_class }, ...children);
}

export function cards(...items: Child[]): HTMLElement {
  return h("div", { class: "grid" }, ...items);
}

// ── Navigation ───────────────────────────────────────────────────────────────

export interface TabItem {
  id: string;
  label: string;
  href: string;
}

export function tabs(items: TabItem[], active: string, label = "Sections"): HTMLElement {
  return h("nav", { class: "tabs", "aria-label": label }, ...items.map((item) =>
    h("a", { href: item.href, class: item.id === active ? "tab active" : "tab", "aria-current": item.id === active ? "page" : null }, item.label)));
}

export function crumbs(items: [label: string, href: string | null][]): HTMLElement {
  return h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, ...items.flatMap(([label, href], index) => [
    index > 0 ? h("span", { class: "muted", "aria-hidden": "true" }, " / ") : null,
    href ? h("a", { href }, label) : h("span", { "aria-current": "page" }, label),
  ]));
}

// ── Toolbars ─────────────────────────────────────────────────────────────────

export function toolbar(...children: Child[]): HTMLElement {
  return h("div", { class: "toolbar" }, ...children);
}

// Steps to the item before or after this one, each a link or a dead button when there is none, with where this one stands between.
export function stepper(label: string, previous: { text: string; href: string | null }, position: Child, next: { text: string; href: string | null }): HTMLElement {
  const step = (target: { text: string; href: string | null }) => target.href === null
    ? h("button", { disabled: true }, target.text)
    : h("a", { class: "button", href: target.href }, target.text);
  return h("div", { class: "stepper", role: "group", "aria-label": label },
    step(previous), h("span", { class: "muted" }, position), step(next));
}
