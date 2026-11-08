// Badges, chips and verdicts: short labels whose tone is written out, so meaning never rests on color alone.

import type { CSSProperties, ReactNode } from "react";

export type Tone = "good" | "warn" | "bad" | "info" | "none";

// ── Badges ───────────────────────────────────────────────────────────────────

export function Badge({ tone = "none", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return <span className={`badge tone-${tone}`} title={title}>{children}</span>;
}

// A badge for one of a fixed set of states, each named by its text and tone.
export function StateBadge<State extends string>({ labels, state, title }: { labels: Record<State, [text: string, tone: Tone]>; state: State; title?: string }) {
  const [text, tone] = labels[state];
  return <Badge tone={tone} title={title}>{text}</Badge>;
}

// ── Chips ────────────────────────────────────────────────────────────────────

interface ChipProps {
  title?: string;
  // Makes the chip a button that picks what it names, such as a tag to filter by.
  on_click?: () => void;
  class_name?: string;
  // The item's own colour, such as a tag's, which tints and edges the chip.
  color?: string | null;
  // Draws the chip dashed, as one put there by a rule rather than by hand.
  dashed?: boolean;
  // Adds a × button that takes the chip off, named by remove_label.
  on_remove?: () => void;
  remove_label?: string;
  children: ReactNode;
}

// A chip, in its item's colour when it has one, that can pick what it names or be removed.
export function Chip({ title, on_click, class_name, color, dashed = false, on_remove, remove_label = "Remove", children }: ChipProps) {
  const chip_class = ["chip", color && "has-color", dashed && "dashed", class_name].filter(Boolean).join(" ");
  const style = color ? { "--item-color": color } as CSSProperties : undefined;
  if (on_click) return <button type="button" className={chip_class} style={style} title={title} onClick={on_click}>{children}</button>;
  return (
    <span className={chip_class} style={style} title={title}>
      {children}
      {on_remove && <button type="button" className="icon remove" aria-label={remove_label} onClick={on_remove}>×</button>}
    </span>
  );
}

// A dot in an item's own colour, set before its name.
export function ColorDot({ color }: { color: string }) {
  return <span className="color-dot" style={{ "--item-color": color } as CSSProperties} aria-hidden="true" />;
}

// A row of chips or badges, with less space between them when they sit inside a line of text.
export function Chips({ inline = false, children }: { inline?: boolean; children: ReactNode }) {
  return <span className={inline ? "chips inline-chips" : "chips"}>{children}</span>;
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

// A pass, fail or not-yet verdict, such as "checks: pass".
export function Verdict({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  const known = ok !== null && ok !== undefined;
  return <span className={`verdict tone-${known ? (ok ? "good" : "bad") : "none"}`}>{label}: {known ? (ok ? "pass" : "fail") : "no verdict"}</span>;
}

// ── Status pills ─────────────────────────────────────────────────────────────

interface StatusPillProps {
  // The dot's colour; busy makes it pulse while work is under way.
  tone?: Tone;
  busy?: boolean;
  label: ReactNode;
  // A button beside the text, such as Pause or Resume.
  action?: ReactNode;
  title?: string;
}

// A state dot and its text, such as "Idle" or "Researching", with an optional button, for a top bar.
export function StatusPill({ tone = "none", busy = false, label, action, title }: StatusPillProps) {
  return (
    <span className="status-pill" title={title}>
      <span className={busy ? `status-dot tone-${tone} busy` : `status-dot tone-${tone}`} aria-hidden="true" />
      <span className="status-text small">{label}</span>
      {action}
    </span>
  );
}
