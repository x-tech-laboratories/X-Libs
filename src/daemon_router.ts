// A desktop app's main process as a portal: every call the page makes goes to the daemon `connections` has chosen,
// this computer's or one on another host, except the calls that belong to this computer whichever daemon is in use,
// such as its sync and trusted certificates. It follows the chosen daemon's events, starts this computer's daemon
// again when it went away, and tells the app when another daemon was chosen, so the page never knows where its daemon
// runs. It holds no Electron, so the app gives it the windows' side as callbacks.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { Connections } from "./connections.ts";
import type { DaemonLink } from "./daemon_link.ts";
import type { SyncStatus } from "./sync_protocol.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface DaemonRouterOptions {
  connections: Pick<Connections, "current" | "subscribe">;
  link: Pick<DaemonLink, "call" | "follow_events">;
  // Posts one call to this computer's daemon over its socket; left out by a portal app, which runs none.
  call_local?: (path: string, args: unknown[], headers: Record<string, string>) => Promise<unknown>;
  // Starts this computer's daemon again after it went away.
  restart_local?: () => Promise<unknown>;
  // The first part of each call's path that stays on this computer, such as "device" for its sync.
  local_tables?: Iterable<string>;
  // Whether a call only reads, so `after_write` is not run for it; every call counts as a write unless given.
  is_read_only?: (name: string) => boolean;
  // The daemon's path for its events and the prefix of its calls.
  events_path?: string;
  api_prefix?: string;
  // The windows hear that the data changed, also after a reconnect that may have missed changes.
  on_change: () => void;
  on_sync_status?: (status: SyncStatus) => void;
  // Any other event the daemon sends, such as one of the app's own.
  on_event?: (event: string, data: string) => void;
  // Another daemon was chosen, so every window starts again on it.
  on_switch: () => void;
  // A call that may have changed something was made, such as for the tray to count again.
  after_write?: () => void;
  on_error?: (error: unknown) => void;
}

export type DaemonRouter = ReturnType<typeof create_daemon_router>;

// What stays on this computer in every app: its sync, its trusted certificates, its MCP endpoint and its own settings.
export const default_local_tables = ["device", "certificates", "local_mcp", "daemon"] as const;

// ── Router ───────────────────────────────────────────────────────────────────

export function create_daemon_router(options: DaemonRouterOptions) {
  const { connections, link } = options;
  const local_tables = new Set(options.local_tables ?? (options.call_local ? default_local_tables : []));
  const events_path = options.events_path ?? "/api/events";
  const api_prefix = options.api_prefix ?? "/api/";
  const on_error = options.on_error ?? ((error: unknown) => console.error(error));
  // Given by the chosen daemon when this process connects, so the window is not told about its own changes.
  let client_id = "";
  let is_quitting = false;
  let stop_following = (): void => {};
  let unsubscribe = (): void => {};

  function is_here(): boolean {
    return connections.current()?.kind !== "remote";
  }

  function is_local_call(path: string): boolean {
    const cut = path.indexOf("/");
    return cut > 0 && local_tables.has(path.slice(0, cut));
  }

  // One call, as the page made it, to this computer's daemon or the chosen one.
  async function call(path: string, args: unknown[] = []): Promise<unknown> {
    const headers = { "x-client-id": client_id };
    const full_path = `${api_prefix}${path}`;
    const result = options.call_local && is_local_call(path)
      ? await options.call_local(full_path, args, is_here() ? headers : {})
      : await link.call(full_path, args, headers);
    if (!options.is_read_only?.(path.slice(path.lastIndexOf("/") + 1))) options.after_write?.();
    return result;
  }

  // Every call in a table, passed on under a path of its own, or one that depends on the daemon in use.
  function forwarded(names: readonly string[], prefix: string | (() => string)): Record<string, (...args: unknown[]) => Promise<unknown>> {
    const prefix_now = typeof prefix === "string" ? () => prefix : prefix;
    return Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => call(`${prefix_now()}/${name}`, args)]));
  }

  // The chosen daemon's changes reach every window, and this computer's daemon starts again when it stopped.
  function follow(): void {
    stop_following = link.follow_events(
      events_path,
      (event, data) => {
        if (event === "hello") client_id = data;
        else if (event === "changed") options.on_change();
        else if (event === "sync_status") options.on_sync_status?.(JSON.parse(data) as SyncStatus);
        else options.on_event?.(event, data);
      },
      {
        on_connect: options.on_change,
        on_disconnect: () => {
          if (!is_quitting && is_here() && options.restart_local) void options.restart_local().catch(on_error);
        },
      },
    );
  }

  return {
    is_here,
    call,
    forwarded,
    // Follows the chosen daemon's events and hears when another one is chosen.
    start: () => {
      follow();
      unsubscribe = connections.subscribe(() => {
        client_id = "";
        options.on_switch();
      });
    },
    // The app is going, so a daemon that goes away is not started again.
    quitting: () => {
      is_quitting = true;
    },
    stop: () => {
      is_quitting = true;
      unsubscribe();
      stop_following();
    },
  };
}
