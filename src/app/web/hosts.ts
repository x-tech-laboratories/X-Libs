// Where the page runs and how it reaches the data there: a browser posts every call to the server it was loaded from
// and follows its event stream; the desktop app's preload has put the main process's calls on the window, which go to
// this computer's daemon or to the server Settings → Connections chose.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { BackupClient } from "../../backups.ts";
import type { CertificateClient } from "../../certificate_protocol.ts";
import { LOCAL_CONNECTION_ID, type ConnectionClient } from "../../connection_protocol.ts";
import type { Client } from "../../electron/bridge.ts";
import type { EventsClient } from "../../electron/events.ts";
import type { PeerListeningClient, SyncDeviceClient } from "../../sync_protocol.ts";
import { LoginNeeded } from "../../web/states.ts";
import type { App, AppEvents } from "../define.ts";
import type { DesktopMethods, PageApi } from "../protocol.ts";

// ── Web ──────────────────────────────────────────────────────────────────────

// Relative, so a server behind a proxy under a folder keeps it.
const call_path = "api/call/";
const backups_path = "api/backups/";
// The server's own sync calls sit beside the route paired devices sync through.
const device_path = "api/sync/";
const events_path = "api/events";
const client_id_header = "x-client-id";
const reconnect_delay_ms = 5000;

// A greeting after the first means the stream reconnected and may have missed changes, so the page reloads too.
function follow_changes(on_change: () => void, on_client_id: (client_id: string) => void): void {
  let has_connected = false;
  const connect = (): void => {
    const events = new EventSource(events_path);
    events.addEventListener("hello", (event) => {
      on_client_id((event as MessageEvent<string>).data);
      if (has_connected) on_change();
      has_connected = true;
    });
    events.addEventListener("changed", on_change);
    // The browser retries a dropped stream by itself but gives up on a refused one, so the page tries again later.
    events.addEventListener("error", () => {
      if (events.readyState === EventSource.CLOSED) setTimeout(connect, reconnect_delay_ms);
    });
  };
  connect();
}

export function web_api(app: Pick<App, "bridges">): PageApi {
  // Given by the server when the page connects, so the page is not told about its own changes.
  let client_id = "";

  // A signed-out page shows the sign-in form, which listens for LoginNeeded, rather than stale data.
  async function post_call(path: string, method: string, args: unknown[]): Promise<unknown> {
    const response = await fetch(path + method, {
      method: "POST",
      headers: { "content-type": "application/json", [client_id_header]: client_id },
      body: JSON.stringify(args),
    });
    if (response.status === 401) throw new LoginNeeded();
    if (!response.ok) throw new Error(await response.text());
    const text = await response.text();
    return text === "" ? undefined : JSON.parse(text);
  }

  const listeners = new Set<() => void>();
  follow_changes(
    () => {
      for (const listener of listeners) listener();
    },
    (given) => (client_id = given),
  );
  const { bridges } = app;
  return {
    host: "web",
    calls: bridges.calls.web_rpc((method, args) => post_call(call_path, method, args)) as PageApi["calls"],
    // The server's own sync peer and backups, which only an admin reaches.
    device: bridges.device.web_rpc((method, args) => post_call(device_path, method, args)),
    backups: bridges.backups.web_rpc((method, args) => post_call(backups_path, method, args)),
    on_change: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ── Desktop ──────────────────────────────────────────────────────────────────

export function is_desktop(app: Pick<App, "bridges">): boolean {
  return app.bridges.calls.api_name in window;
}

// The window starts again whenever another daemon is chosen, so where it runs is read once here.
export async function desktop_api(app: Pick<App, "bridges">): Promise<PageApi> {
  const exposed = window as unknown as Record<string, unknown>;
  const { bridges } = app;
  const events = exposed[bridges.events.api_name] as EventsClient<AppEvents>;
  const connections = exposed[bridges.connections.api_name] as ConnectionClient;
  const is_here = (await connections.list_connections()).current === LOCAL_CONNECTION_ID;
  return {
    host: "desktop",
    calls: exposed[bridges.calls.api_name] as PageApi["calls"],
    // Sync belongs to this computer's own daemon, so it shows only while that daemon is in use.
    device: is_here ? (exposed[bridges.device.api_name] as SyncDeviceClient) : null,
    ...(is_here ? { peer_listening: exposed[bridges.peer_listening.api_name] as PeerListeningClient } : {}),
    backups: exposed[bridges.backups.api_name] as BackupClient,
    certificates: exposed[bridges.certificates.api_name] as CertificateClient,
    connections,
    desktop: exposed[bridges.desktop.api_name] as Client<DesktopMethods>,
    on_change: (listener) => events.on("changed", listener),
  };
}

// ── Phone ────────────────────────────────────────────────────────────────────

// Capacitor's native shell names its platform on the window.
export function is_android(): boolean {
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return capacitor?.getPlatform?.() === "android";
}
