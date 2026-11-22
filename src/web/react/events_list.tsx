// A log of what happened, newest as given: each event's age, its level as a badge and its message, with room for the
// app's own part, such as a link to what it happened to.

import type { ReactNode } from "react";

import { age, stamp } from "../format.ts";
import { StateBadge, type Tone } from "./badges.tsx";
import { Empty } from "./states.tsx";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type EventLevel = "info" | "warning" | "error";

export interface EventEntry {
  // When it happened; an entry without one, such as a message from the last check, shows no time.
  epoch?: number | null;
  // A level in any case, such as "WARNING".
  level: string;
  message: ReactNode;
}

const level_labels: Record<EventLevel, [text: string, tone: Tone]> = { info: ["info", "none"], warning: ["warning", "warn"], error: ["error", "bad"] };

// ── Badges ───────────────────────────────────────────────────────────────────

// An event's level as a badge, in any case, an unknown one shown as it is in no tone.
export function LevelBadge({ level }: { level: string }) {
  const known = level.toLowerCase();
  if (Object.hasOwn(level_labels, known)) return <StateBadge labels={level_labels} state={known as EventLevel} />;
  return <StateBadge labels={{ [level]: [level, "none"] }} state={level} />;
}

// ── List ─────────────────────────────────────────────────────────────────────

interface EventsListProps<Entry extends EventEntry> {
  events: Entry[];
  row_key?: (event: Entry, index: number) => string | number;
  // The app's own part of a row, shown between the badge and the message.
  extra?: (event: Entry) => ReactNode;
  // What shows when there is nothing; the empty list unless set.
  empty?: ReactNode;
}

export function EventsList<Entry extends EventEntry>({ events, row_key, extra, empty }: EventsListProps<Entry>) {
  if (events.length === 0 && empty !== undefined) return typeof empty === "string" ? <Empty title={empty} /> : <>{empty}</>;
  return (
    <ul className="events">
      {events.map((event, index) => (
        <li key={row_key?.(event, index) ?? index} className={`level-${event.level.toLowerCase()}`}>
          {event.epoch != null && <span className="event-time muted small" title={stamp(event.epoch)}>{age(event.epoch)}</span>}
          <LevelBadge level={event.level} />
          {extra?.(event)}
          <span className="event-message">{event.message}</span>
        </li>
      ))}
    </ul>
  );
}
