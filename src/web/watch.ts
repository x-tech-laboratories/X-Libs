// A change counter a store bumps and a page watches, so only what reads the store redraws when it changes.

export interface Watch {
  version(): number;
  bump(): void;
  // Returns the function that stops listening.
  subscribe(listener: () => void): () => void;
}

export function create_watch(): Watch {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    version: () => version,
    bump: () => {
      version += 1;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

// ── Coalescing ───────────────────────────────────────────────────────────────

export interface CoalescedBump {
  // Asks for a bump, which lands at most once per interval, so streaming tokens redraw the page at a steady pace.
  (): void;
  // Drops a bump still waiting, for a page that is going away.
  cancel(): void;
}

export function coalesce_bumps(watch: Watch, interval_in_milliseconds: number, now: () => number = () => performance.now()): CoalescedBump {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last_bump_at = -Infinity;

  const schedule = () => {
    if (timer !== null) return;
    const wait = Math.max(0, interval_in_milliseconds - (now() - last_bump_at));
    timer = setTimeout(() => {
      timer = null;
      last_bump_at = now();
      watch.bump();
    }, wait);
  };
  schedule.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return schedule;
}
