// What a device and the server send each other to keep one app's SQLite data alike everywhere: every value of every
// synced row travels on its own, with the version that decides which device's write wins.

// ── Changes ──────────────────────────────────────────────────────────────────

// One value of one row; the later time wins, then the larger device id.
export interface SyncChange {
  table: string;
  key: string;
  column: string;
  value: unknown;
  ts: number;
  site: string;
}

// ── Server calls ─────────────────────────────────────────────────────────────

// A device names the server data it follows by generation; replacing or restoring the server's data starts a new one.
export interface SyncExchangeRequest {
  site: string;
  generation: string;
  // The server's change counter the device has seen up to.
  cursor: number;
  changes: SyncChange[];
}

export interface SyncExchangeResponse {
  generation: string;
  cursor: number;
  changes: SyncChange[];
}

// Every row the server holds, with the counter it was read at.
export type SyncSnapshot = SyncExchangeResponse;

export interface SyncReplaceRequest {
  changes: SyncChange[];
}

export interface SyncReplaceResponse {
  generation: string;
  cursor: number;
}

export interface SyncPaths {
  exchange: string;
  snapshot: string;
  replace: string;
  events: string;
}

// Relative to the server's address, so a server under a folder keeps it.
export const default_sync_paths: SyncPaths = {
  exchange: "api/sync/exchange",
  snapshot: "api/sync/snapshot",
  replace: "api/sync/replace",
  events: "api/events",
};

// ── Device status ────────────────────────────────────────────────────────────

// Which copy wins when a device first connects: the server's replaces this device's, or this device's replaces the server's.
export type SyncDirection = "download" | "upload";

// Off with no server set; needs_setup when the server's data was replaced and the device must choose a direction again.
export type SyncState = "off" | "idle" | "syncing" | "offline" | "needs_setup" | "failed";

export interface SyncStatus {
  state: SyncState;
  server_url: string;
  // When the last exchange with the server finished, as an ISO time; empty if never.
  last_synced_at: string;
  // How many rows this device changed that the server has not had yet.
  pending_changes: number;
  error: string;
}

export function is_change_list(value: unknown): value is SyncChange[] {
  return Array.isArray(value) && value.every((change) => typeof change === "object" && change !== null && "table" in change && "key" in change);
}
