// Badges, chips and verdicts: short labels whose tone is written out, so meaning never rests on color alone.

import { h, type Child } from "./dom.ts";

// ── Tones ────────────────────────────────────────────────────────────────────

export type Tone = "good" | "warn" | "bad" | "info" | "none";

// ── Badges ───────────────────────────────────────────────────────────────────

export function badge(text: Child, tone: Tone = "none", title = ""): HTMLElement {
  return h("span", { class: `badge tone-${tone}`, title: title || null }, text);
}

// A badge for one of a fixed set of states, each named by its text and tone.
export function state_badge<State extends string>(labels: Record<State, [text: string, tone: Tone]>, state: State): HTMLElement {
  const [text, tone] = labels[state];
  return badge(text, tone);
}

// ── Chips ────────────────────────────────────────────────────────────────────

export function chip(text: Child, title = ""): HTMLElement {
  return h("span", { class: "chip", title: title || null }, text);
}

// A chip that picks what it names, such as a tag to filter by.
export function chip_button(text: Child, on_click: () => void, title = ""): HTMLElement {
  return h("button", { type: "button", class: "chip", title: title || null, onclick: on_click }, text);
}

// A row of chips or badges, with less space between them when they sit inside a line of text.
export function chips(items: Child[], options: { inline?: boolean } = {}): HTMLElement {
  return h("span", { class: options.inline ? "chips inline-chips" : "chips" }, ...items);
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

// A pass, fail or not-yet verdict, such as "checks: pass".
export function verdict(ok: boolean | null | undefined, label: string): HTMLElement {
  const text = ok === null || ok === undefined ? "no verdict" : ok ? "pass" : "fail";
  const tone = ok === null || ok === undefined ? "none" : ok ? "good" : "bad";
  return h("span", { class: `verdict tone-${tone}` }, `${label}: ${text}`);
}
