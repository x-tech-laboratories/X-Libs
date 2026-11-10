// Times as the page shows them: how long ago, with the full date and time on hover, the current time kept fresh, and a
// countdown such as a rest between sets.

import { useEffect, useMemo, useRef, useState } from "react";
import { age, stamp } from "../format.ts";

// A time as its age, such as "3h ago", or the missing text, a dash unless told otherwise, when there is none.
export function Age({ epoch, missing = "—" }: { epoch: number | null | undefined; missing?: string }) {
  if (!epoch) return <>{missing}</>;
  return <span title={stamp(epoch)}>{age(epoch)}</span>;
}

// The current time, read again every interval, a minute unless told otherwise, so a page notices the day turning.
export function use_now(interval_in_milliseconds = 60_000): Date {
  const [now, set_now] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => set_now(new Date()), interval_in_milliseconds);
    return () => clearInterval(timer);
  }, [interval_in_milliseconds]);
  return now;
}

// ── Countdown ────────────────────────────────────────────────────────────────

export interface Countdown {
  // Whole seconds in all and left.
  total: number;
  remaining: number;
  // When it reaches zero, in milliseconds since the epoch; null while paused.
  ends_at: number | null;
}

export interface CountdownControls {
  // null while none runs.
  countdown: Countdown | null;
  // Starts afresh; nothing for 0 seconds or fewer.
  start: (seconds: number) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  // Adds seconds to the one running or paused, to its total too, or takes them off when negative, never below zero.
  extend: (seconds: number) => void;
}

// A countdown that runs off a wall-clock deadline rather than counting ticks, so a page that slept, such as a phone
// between sets, comes back showing the time really left. It is read again every interval, 200 ms unless told otherwise;
// on_done runs once when it reaches zero, and the countdown then clears.
export function use_countdown(on_done: () => void, interval_in_milliseconds = 200): CountdownControls {
  const [countdown, set_countdown] = useState<Countdown | null>(null);
  const done_ref = useRef(on_done);
  done_ref.current = on_done;

  const ends_at = countdown?.ends_at ?? null;
  useEffect(() => {
    if (ends_at === null) return;
    const read = () => set_countdown((current) => (current?.ends_at ? { ...current, remaining: seconds_left(current.ends_at) } : current));
    read();
    const timer = setInterval(read, interval_in_milliseconds);
    return () => clearInterval(timer);
  }, [ends_at, interval_in_milliseconds]);

  const done = ends_at !== null && countdown?.remaining === 0;
  useEffect(() => {
    if (!done) return;
    set_countdown(null);
    done_ref.current();
  }, [done]);

  const controls = useMemo(
    () => ({
      start: (seconds: number) => {
        if (seconds > 0) set_countdown({ total: seconds, remaining: seconds, ends_at: Date.now() + seconds * 1000 });
      },
      stop: () => set_countdown(null),
      pause: () => set_countdown((current) => (current?.ends_at ? { ...current, remaining: seconds_left(current.ends_at), ends_at: null } : current)),
      resume: () => set_countdown((current) => (current && current.ends_at === null ? { ...current, ends_at: Date.now() + current.remaining * 1000 } : current)),
      extend: (seconds: number) =>
        set_countdown((current) => {
          if (!current) return current;
          const remaining = Math.max(0, current.remaining + seconds);
          const added = remaining - current.remaining;
          return { total: Math.max(remaining, current.total + added), remaining, ends_at: current.ends_at === null ? null : current.ends_at + added * 1000 };
        }),
    }),
    [],
  );
  return { countdown, ...controls };
}

function seconds_left(ends_at: number): number {
  return Math.max(0, Math.ceil((ends_at - Date.now()) / 1000));
}
