import { afterEach, describe, expect, test, vi } from "vitest";

import { keep_giving_scheduled_notices, type DueNotice } from "../../src/agent/scheduled_notices.ts";
import { Notifier } from "../../src/agent/desktop_notify.ts";

afterEach(() => {
  vi.useRealTimers();
});

const hour = 3600 * 1000;
const start = Date.parse("2026-11-19T12:00:00Z");

// Notices due at the given moments, each shown once its moment falls in a check's window.
function due_at(...moments: number[]) {
  return (after: number, until: number): DueNotice[] =>
    moments.filter((moment) => moment > after && moment <= until).map((moment) => ({ key: `at-${moment}`, title: "Lunch", body: new Date(moment).toISOString() }));
}

describe("scheduled notices", () => {
  test("show each notice once as its moment passes, and keep where they got to", async () => {
    vi.useFakeTimers({ now: start });
    const shown: string[] = [];
    const kept: number[] = [];
    const stop = keep_giving_scheduled_notices({
      notifier: { show: (notice) => shown.push(notice.key) },
      due: due_at(start + 45_000, start + 50_000, start + 200_000),
      write_checked_until: (moment) => kept.push(moment),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(shown).toEqual([`at-${start + 45_000}`, `at-${start + 50_000}`]);
    expect(kept).toEqual([start + 60_000]);
  });

  test("show what fell while stopped, but none more than half a day late", () => {
    vi.useFakeTimers({ now: start });
    const shown: string[] = [];

    const stop = keep_giving_scheduled_notices({
      notifier: { show: (notice) => shown.push(notice.key) },
      due: due_at(start - 20 * hour, start - 2 * hour),
      read_checked_until: () => start - 24 * hour,
    });
    stop();

    expect(shown).toEqual([`at-${start - 2 * hour}`]);
  });

  test("try again on the next check when working out the notices fails", async () => {
    vi.useFakeTimers({ now: start });
    const shown: string[] = [];
    const errors: string[] = [];
    let fail = true;
    const stop = keep_giving_scheduled_notices({
      notifier: { show: (notice) => shown.push(notice.key) },
      due: (after, until) => {
        if (fail) throw new Error("the database is locked");
        return due_at(start + 10_000)(after, until);
      },
      on_error: (error) => errors.push((error as Error).message),
    });

    await vi.advanceTimersByTimeAsync(20_000);
    fail = false;
    await vi.advanceTimersByTimeAsync(20_000);
    stop();

    expect(errors).toEqual(["the database is locked"]);
    expect(shown).toEqual([`at-${start + 10_000}`]);
  });

  test("take X-App's Notifier as it is", () => {
    const notifier = new Notifier({ app_name: "X-Fitness", start: () => Promise.reject(new Error("no notify-send")) });

    keep_giving_scheduled_notices({ notifier, due: () => [] })();
  });
});
