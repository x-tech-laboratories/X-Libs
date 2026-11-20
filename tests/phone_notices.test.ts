import { afterEach, describe, expect, test, vi } from "vitest";

import { keep_phone_notices, notice_horizon_ms, notice_id, soonest_notices, type LocalNotificationsLike, type PhoneNotice } from "../src/phone_notices.ts";

afterEach(() => {
  vi.useRealTimers();
});

const start = Date.parse("2026-11-19T12:00:00Z");

const notice = (key: string, at: number, extra?: Record<string, string>): PhoneNotice => ({ key, title: key, body: "", at, ...(extra ? { extra } : {}) });

// LocalNotifications standing in, keeping what is pending and the tap listener it is given.
function fake_plugin(display = "granted") {
  const state = { pending: [] as { id: number; title: string; at: Date; extra?: Record<string, string> }[], shown: [] as unknown[], exact: [] as (boolean | undefined)[], asked: 0, display, tap: undefined as ((action: { notification: { extra?: unknown } }) => void) | undefined };
  const plugin: LocalNotificationsLike = {
    getPending: async () => ({ notifications: state.pending.map(({ id }) => ({ id })) }),
    cancel: async ({ notifications }) => {
      state.pending = state.pending.filter((pending) => !notifications.some(({ id }) => id === pending.id));
    },
    checkPermissions: async () => ({ display: state.display }),
    requestPermissions: async () => {
      state.asked += 1;
      return { display: state.display };
    },
    schedule: async ({ notifications }) => {
      for (const item of notifications) state.exact.push(item.isExactNotification);
      const now = notifications.filter((item) => item.schedule === undefined);
      state.shown.push(...now);
      state.pending.push(...notifications.filter((item) => item.schedule !== undefined).map((item) => ({ id: item.id, title: item.title, at: item.schedule!.at, ...(item.extra ? { extra: item.extra } : {}) })));
    },
    addListener: async (_event, listener) => {
      state.tap = listener;
    },
  };
  return { plugin, state };
}

describe("notices", () => {
  test("are named by a positive 32-bit number that stays the same for a key", () => {
    expect(notice_id("lunch")).toBe(notice_id("lunch"));
    expect(notice_id("lunch")).not.toBe(notice_id("dinner"));
    expect(notice_id("lunch")).toBeGreaterThan(0);
    expect(notice_id("lunch")).toBeLessThanOrEqual(0x7fffffff);
  });

  test("still to come are kept, soonest first, up to Android's cap", () => {
    const notices = [notice("c", start + 3000), notice("past", start - 1), notice("a", start + 1000), notice("b", start + 2000)];

    expect(soonest_notices(notices, start).map(({ key }) => key)).toEqual(["a", "b", "c"]);
    expect(soonest_notices(notices, start, 2).map(({ key }) => key)).toEqual(["a", "b"]);
  });
});

describe("handing notices to Android", () => {
  test("sets them again in one go after changes close together, replacing the ones before", async () => {
    vi.useFakeTimers({ now: start });
    const { plugin, state } = fake_plugin();
    let lunch = start + 3600_000;
    const asked: [number, number][] = [];
    const notices = keep_phone_notices({
      plugin,
      read: (now, until) => {
        asked.push([now, until]);
        return [notice("lunch", lunch, { url: "x-fitness://diet/diary" })];
      },
      on_tap: () => undefined,
    });

    notices.refresh();
    notices.refresh();
    await vi.advanceTimersByTimeAsync(600);
    lunch += 600_000;
    notices.refresh();
    await vi.advanceTimersByTimeAsync(600);

    expect(asked).toEqual([
      [start + 500, start + 500 + notice_horizon_ms],
      [start + 1100, start + 1100 + notice_horizon_ms],
    ]);
    expect(state.pending).toEqual([{ id: notice_id("lunch"), title: "lunch", at: new Date(start + 4200_000), extra: { url: "x-fitness://diet/diary" } }]);
  });

  test("set none without leave to show notifications, but still take back the old ones", async () => {
    vi.useFakeTimers({ now: start });
    const { plugin, state } = fake_plugin("denied");
    state.pending = [{ id: 7, title: "old", at: new Date(start) }];
    const notices = keep_phone_notices({ plugin, read: () => [notice("lunch", start + 1000)], on_tap: () => undefined });

    notices.refresh();
    await vi.advanceTimersByTimeAsync(600);
    await notices.ask_permission();

    expect(state.pending).toEqual([]);
    expect(state.asked).toBe(0);
  });

  test("ask for leave only while it was never answered, and hand a tap's extra back", async () => {
    const { plugin, state } = fake_plugin("prompt");
    const taps: Record<string, string>[] = [];
    const notices = keep_phone_notices({ plugin, read: () => [], on_tap: (extra) => taps.push(extra) });

    await notices.ask_permission();
    state.tap!({ notification: { extra: { url: "x-fitness://workouts/log" } } });
    state.tap!({ notification: {} });

    expect(state.asked).toBe(1);
    expect(taps).toEqual([{ url: "x-fitness://workouts/log" }]);
  });

  test("show one at once with no alarm, so Android never asks for exact alarms", async () => {
    const { plugin, state } = fake_plugin();
    const notices = keep_phone_notices({ plugin, read: () => [], on_tap: () => undefined });

    expect(await notices.show({ key: "run-7", title: "Run finished", body: "plan", extra: { url: "x-dev://items/7" } })).toBe(true);
    expect(await notices.show({ key: "run-8", title: "Run failed", body: "" })).toBe(true);

    expect(state.shown).toEqual([
      { id: notice_id("run-7"), title: "Run finished", body: "plan", isExactNotification: false, extra: { url: "x-dev://items/7" } },
      { id: notice_id("run-8"), title: "Run failed", body: "", isExactNotification: false },
    ]);
    expect(state.pending).toEqual([]);
  });

  test("show none at once without leave to show notifications", async () => {
    const { plugin, state } = fake_plugin("prompt");
    const notices = keep_phone_notices({ plugin, read: () => [], on_tap: () => undefined });

    expect(await notices.show({ key: "run-7", title: "Run finished", body: "" })).toBe(false);
    expect(state.shown).toEqual([]);
  });

  test("set notices ahead as exact alarms unless the app lets them be inexact", async () => {
    vi.useFakeTimers({ now: start });
    const exact = fake_plugin();
    const inexact = fake_plugin();
    keep_phone_notices({ plugin: exact.plugin, read: () => [notice("lunch", start + 60_000)], on_tap: () => undefined }).refresh();
    keep_phone_notices({ plugin: inexact.plugin, read: () => [notice("lunch", start + 60_000)], on_tap: () => undefined, exact: false }).refresh();
    await vi.advanceTimersByTimeAsync(600);

    expect(exact.state.exact).toEqual([true]);
    expect(inexact.state.exact).toEqual([false]);
  });
});
