// Badges, chips and verdicts: short labels whose tone is written out, so meaning never rests on color alone.

import type { ComponentChildren } from "preact";

export type Tone = "good" | "warn" | "bad" | "info" | "none";

// ── Badges ───────────────────────────────────────────────────────────────────

export function Badge({ tone = "none", title, children }: { tone?: Tone; title?: string; children: ComponentChildren }) {
  return <span class={`badge tone-${tone}`} title={title}>{children}</span>;
}

// A badge for one of a fixed set of states, each named by its text and tone.
export function StateBadge<State extends string>({ labels, state, title }: { labels: Record<State, [text: string, tone: Tone]>; state: State; title?: string }) {
  const [text, tone] = labels[state];
  return <Badge tone={tone} title={title}>{text}</Badge>;
}

// ── Chips ────────────────────────────────────────────────────────────────────

// A chip, or a button chip that picks what it names when it has on_click, such as a tag to filter by.
export function Chip({ title, on_click, class_name, children }: { title?: string; on_click?: () => void; class_name?: string; children: ComponentChildren }) {
  const chip_class = class_name ? `chip ${class_name}` : "chip";
  return on_click
    ? <button type="button" class={chip_class} title={title} onClick={on_click}>{children}</button>
    : <span class={chip_class} title={title}>{children}</span>;
}

// A row of chips or badges, with less space between them when they sit inside a line of text.
export function Chips({ inline = false, children }: { inline?: boolean; children: ComponentChildren }) {
  return <span class={inline ? "chips inline-chips" : "chips"}>{children}</span>;
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

// A pass, fail or not-yet verdict, such as "checks: pass".
export function Verdict({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  const known = ok !== null && ok !== undefined;
  return <span class={`verdict tone-${known ? (ok ? "good" : "bad") : "none"}`}>{label}: {known ? (ok ? "pass" : "fail") : "no verdict"}</span>;
}
