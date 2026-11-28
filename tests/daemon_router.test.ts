import { describe, expect, it, vi } from "vitest";

import type { CurrentDaemon } from "../src/connections.ts";
import { create_daemon_router, type DaemonRouterOptions } from "../src/daemon_router.ts";
import type { FollowOptions } from "../src/local_daemon.ts";

// ============================================================================
// Helpers
// ============================================================================

interface Sent {
  where: "local" | "link";
  path: string;
  args: unknown[];
  headers: Record<string, string>;
}

// A connection list whose daemon the test switches, a link that records its calls, and the events it streams.
function setup(start: CurrentDaemon = { kind: "local" }, extra: Partial<DaemonRouterOptions> = {}) {
  let daemon = start;
  const listeners = new Set<(daemon: CurrentDaemon) => void>();
  const sent: Sent[] = [];
  let emit: (event: string, data: string) => void = () => {};
  let follow_options: FollowOptions = {};
  const stop_following = vi.fn();

  const options: DaemonRouterOptions = {
    connections: {
      current: () => daemon,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    link: {
      call: async (path, args = [], headers = {}) => {
        sent.push({ where: "link", path, args, headers });
        return "from link";
      },
      follow_events: (_path, on_event, given = {}) => {
        emit = on_event;
        follow_options = given;
        return stop_following;
      },
    },
    call_local: async (path, args, headers) => {
      sent.push({ where: "local", path, args, headers });
      return "from local";
    },
    restart_local: vi.fn(async () => "started"),
    on_change: vi.fn(),
    on_switch: vi.fn(),
    ...extra,
  };
  const router = create_daemon_router(options);

  function choose(next: CurrentDaemon): void {
    daemon = next;
    for (const listener of listeners) listener(next);
  }

  return { router, options, sent, choose, stop_following, emit: (event: string, data: string) => emit(event, data), follow_options: () => follow_options };
}

const remote: CurrentDaemon = { kind: "remote", id: "home", address: "https://home.example", token: "t" };

// ============================================================================
// Calls
// ============================================================================

describe("calls", () => {
  it("sends the app's calls through the link and this computer's own calls to its daemon", async () => {
    const { router, sent } = setup(remote);

    expect(await router.call("call/list_items", [1])).toBe("from link");
    expect(await router.call("device/sync_now")).toBe("from local");

    expect(sent.map(({ where, path, args }) => [where, path, args])).toEqual([
      ["link", "/api/call/list_items", [1]],
      ["local", "/api/device/sync_now", []],
    ]);
  });

  it("sends the client id the daemon gave, but not to this computer while another daemon is chosen", async () => {
    const { router, sent, emit } = setup(remote);
    router.start();
    emit("hello", "client-7");

    await router.call("call/list_items");
    await router.call("certificates/list");

    expect(sent[0]!.headers).toEqual({ "x-client-id": "client-7" });
    expect(sent[1]!.headers).toEqual({});
  });

  it("sends everything through the link in a portal app with no daemon of its own", async () => {
    const { router, sent } = setup(remote, { call_local: undefined });

    await router.call("device/sync_now");

    expect(sent[0]!.where).toBe("link");
  });

  it("keeps the tables the app names on this computer", async () => {
    const { router, sent } = setup(remote, { local_tables: ["players"] });

    await router.call("players/play");
    await router.call("device/sync_now");

    expect(sent.map(({ where }) => where)).toEqual(["local", "link"]);
  });

  it("runs after_write for every call but the ones that only read", async () => {
    const after_write = vi.fn();
    const { router } = setup({ kind: "local" }, { after_write, is_read_only: (name) => name.startsWith("list_") });

    await router.call("call/list_items");
    await router.call("call/add_item", ["x"]);

    expect(after_write).toHaveBeenCalledTimes(1);
  });

  it("forwards a table of calls under its prefix, or one worked out at each call", async () => {
    const { router, sent, choose } = setup();
    const fixed = router.forwarded(["list_items"], "call");
    const moving = router.forwarded(["list_backups"], () => (router.is_here() ? "device" : "backup"));

    await fixed.list_items!(true);
    await moving.list_backups!();
    choose(remote);
    await moving.list_backups!();

    expect(sent.map(({ path }) => path)).toEqual(["/api/call/list_items", "/api/device/list_backups", "/api/backup/list_backups"]);
  });
});

// ============================================================================
// Events
// ============================================================================

describe("events", () => {
  it("passes changes, sync status and the app's own events on", () => {
    const on_sync_status = vi.fn();
    const on_event = vi.fn();
    const { router, options, emit } = setup({ kind: "local" }, { on_sync_status, on_event });
    router.start();

    emit("changed", "null");
    emit("sync_status", JSON.stringify({ state: "idle" }));
    emit("run_finished", "r1");

    expect(options.on_change).toHaveBeenCalledTimes(1);
    expect(on_sync_status).toHaveBeenCalledWith({ state: "idle" });
    expect(on_event).toHaveBeenCalledWith("run_finished", "r1");
  });

  it("treats a reconnect as a change, since changes may have been missed", () => {
    const { router, options, follow_options } = setup();
    router.start();

    follow_options().on_connect!();

    expect(options.on_change).toHaveBeenCalledTimes(1);
  });

  it("starts this computer's daemon again when it went away, but not while quitting or on another daemon", () => {
    const { router, options, follow_options, choose } = setup();
    router.start();

    follow_options().on_disconnect!();
    choose(remote);
    follow_options().on_disconnect!();
    choose({ kind: "local" });
    router.quitting();
    follow_options().on_disconnect!();

    expect(options.restart_local).toHaveBeenCalledTimes(1);
  });

  it("tells of a failed restart", async () => {
    const on_error = vi.fn();
    const { router, follow_options } = setup({ kind: "local" }, { restart_local: async () => Promise.reject(new Error("no")), on_error });
    router.start();

    follow_options().on_disconnect!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(on_error).toHaveBeenCalledWith(new Error("no"));
  });

  it("forgets the client id and starts the windows again when another daemon is chosen, until stopped", async () => {
    const { router, options, emit, sent, choose, stop_following } = setup();
    router.start();
    emit("hello", "client-1");

    choose(remote);
    await router.call("call/list_items");
    router.stop();
    choose({ kind: "local" });

    expect(sent[0]!.headers).toEqual({ "x-client-id": "" });
    expect(options.on_switch).toHaveBeenCalledTimes(1);
    expect(stop_following).toHaveBeenCalled();
  });
});
