// The daemons a desktop or phone app can connect to, as the page sees them: "This computer" for the local daemon, and
// daemons on other hosts by address, each signed in once for a token the page never sees. It pairs with `connections`,
// which keeps the list wherever the app's bridge runs, and `web/react/connections`, the Connections section of Settings.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { SyncCredentials } from "./sync_protocol.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// The local daemon's id, the same on every device.
export const LOCAL_CONNECTION_ID = "local";

// The name, password and the code when the daemon asks, the same as signing in to sync.
export type ConnectionCredentials = SyncCredentials;

export interface ConnectionSummary {
  id: string;
  name: string;
  kind: "local" | "remote";
  // The daemon's address, such as "https://tasks.example.org", or "" for the local daemon.
  address: string;
  // Who the device signed in as, or "" for the local daemon.
  user: string;
}

export interface ConnectionsView {
  connections: ConnectionSummary[];
  // The id of the daemon the app talks to, or null while none is chosen.
  current: string | null;
}

// ── Saved list ───────────────────────────────────────────────────────────────

// A daemon on another host as `connections` keeps it, with the token this device signs in with.
export interface SavedConnection {
  id: string;
  name: string;
  address: string;
  user: string;
  token: string;
}

export interface SavedConnections {
  current: string | null;
  remotes: SavedConnection[];
}

export interface ConnectionStorage {
  // Null while nothing has been saved.
  read(): SavedConnections | null;
  write(saved: SavedConnections): void;
}

// ── Calls ────────────────────────────────────────────────────────────────────

// The calls the page makes, answered by `connections` through the app's bridge.
export interface ConnectionMethods {
  list_connections(): Promise<ConnectionsView>;
  // Signs in to the daemon at the address and adds it; named after its host unless a name is given.
  add_connection(address: string, credentials: ConnectionCredentials, name?: string): Promise<ConnectionsView>;
  rename_connection(id: string, name: string): Promise<ConnectionsView>;
  // Forgets a remote daemon and gives its token back; the local daemon cannot be removed.
  remove_connection(id: string): Promise<ConnectionsView>;
  choose_connection(id: string): Promise<ConnectionsView>;
}

export type ConnectionClient = ConnectionMethods;

export const connection_method_names = ["list_connections", "add_connection", "rename_connection", "remove_connection", "choose_connection"] as const satisfies readonly (keyof ConnectionMethods)[];

// ── Addresses ────────────────────────────────────────────────────────────────

// An address as typed, made whole: https:// when no scheme is given, and no slash at the end, so the same daemon is
// always written the same way. Only http and https are allowed.
export function connection_address(typed: string): string {
  const text = typed.trim();
  if (text === "") throw new Error("Enter the daemon's address.");
  const whole = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(whole)![1]!.toLowerCase();
  if (scheme !== "http" && scheme !== "https") throw new Error("The daemon's address must start with http:// or https://.");
  const parts = /^https?:\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(whole);
  if (!parts) throw new Error(`"${text}" is not a daemon's address.`);
  return `${scheme}://${parts[1]!.toLowerCase()}${parts[2]!.replace(/\/+$/, "")}`;
}

// ── Storage in memory ────────────────────────────────────────────────────────

// The daemons a device knows, kept in memory alone, such as for a test or a page that forgets them on reload.
export function memory_connection_storage(): ConnectionStorage {
  let saved: SavedConnections | null = null;
  return {
    read: () => saved,
    write: (next) => {
      saved = next;
    },
  };
}
