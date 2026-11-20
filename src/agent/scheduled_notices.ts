// Notices that fall due at set moments, such as reminders, shown by a daemon whether a window is open or not. Each check
// shows what fell due since the one before; the moment it reached is kept, so a notice that fell while the daemon was
// stopped still shows when it starts, up to half a day late.

// ── Shapes ───────────────────────────────────────────────────────────────────

// One notice to show; a newer notice with the same key replaces it on screen.
export interface DueNotice {
  key: string;
  title: string;
  body: string;
  // Opened when the notice is clicked, such as the app's link to the item.
  url?: string;
  // An icon name the notifier knows, such as "app".
  icon?: string;
}

// What shows notices: X-Libs' Notifier, or a stand-in in a test.
export interface NoticeShower {
  show(notice: DueNotice): unknown;
}

export interface ScheduledNoticesOptions {
  notifier: NoticeShower;
  // The notices that fell due after one moment and up to another, both in milliseconds since 1970.
  due: (after: number, until: number) => DueNotice[];
  // The moment the last check that showed something reached, or null when none was kept.
  read_checked_until?: () => number | null;
  write_checked_until?: (moment: number) => void;
  // How often to check, so a notice is at most this late; 30 seconds unless set.
  check_ms?: number;
  // How late a notice missed while stopped may still show; half a day unless set.
  most_late_ms?: number;
  // The clock; Date.now unless set.
  now?: () => number;
  // Told when working out or showing the notices failed; the next check tries again.
  on_error?: (error: unknown) => void;
}

// ── Checks ───────────────────────────────────────────────────────────────────

const half_a_day_ms = 12 * 3600 * 1000;

// Checks at once and then on a timer; returns how to stop.
export function keep_giving_scheduled_notices(options: ScheduledNoticesOptions): () => void {
  const now = options.now ?? Date.now;
  const report = options.on_error ?? (() => {});
  const started = now();
  const kept = options.read_checked_until?.() ?? null;
  let checked_until = kept === null ? started : Math.max(kept, started - (options.most_late_ms ?? half_a_day_ms));

  function check(): void {
    const until = now();
    let notices: DueNotice[];
    try {
      notices = options.due(checked_until, until);
    } catch (error) {
      report(error);
      return;
    }
    checked_until = until;
    for (const notice of notices) {
      try {
        void Promise.resolve(options.notifier.show(notice)).catch(report);
      } catch (error) {
        report(error);
      }
    }
    if (notices.length > 0) options.write_checked_until?.(until);
  }

  check();
  const timer = setInterval(check, options.check_ms ?? 30_000);
  return () => clearInterval(timer);
}
