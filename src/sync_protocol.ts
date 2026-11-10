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
  // Where a device signs in for a token of its own, and gives it back.
  login: string;
  logout: string;
}

// Relative to the server's address, so a server under a folder keeps it.
export const default_sync_paths: SyncPaths = {
  exchange: "api/sync/exchange",
  snapshot: "api/sync/snapshot",
  replace: "api/sync/replace",
  events: "api/events",
  login: "api/login",
  logout: "api/logout",
};

// ── Device storage ───────────────────────────────────────────────────────────

export interface SyncConfig {
  server_url: string;
  token: string;
  // Who the token signed in as, when the device signed in for it.
  user?: string;
}

// Where each platform keeps the server and its token, and how it saves a copy of the data before the server's replaces it.
export interface SyncStorage {
  read_config: () => SyncConfig | null;
  write_config: (config: SyncConfig) => void;
  remove_config: () => void;
  back_up_before_download: () => void | Promise<void>;
}

// ── Device status ────────────────────────────────────────────────────────────

// Which copy wins when a device first connects: the server's replaces this device's, or this device's replaces the server's.
export type SyncDirection = "download" | "upload";

// Off with no server set; needs_setup when the server's data was replaced and the device must choose a direction again.
export type SyncState = "off" | "idle" | "syncing" | "offline" | "needs_setup" | "failed";

// What a device signs in to the server with; the code only once the server asks for it.
export interface SyncCredentials {
  name: string;
  password: string;
  code?: string;
}

// What the server says when the password was right and only the authenticator code is missing.
const code_needed_text = "Enter the code from your authenticator app.";

// Whether a refused connect asks for the authenticator code, even after crossing to the page as plain text.
export function asks_for_code(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes(code_needed_text);
}

export interface SyncStatus {
  state: SyncState;
  server_url: string;
  // Who the device is signed in as; empty when it syncs with a token given by hand.
  user: string;
  // When the last exchange with the server finished, as an ISO time; empty if never.
  last_synced_at: string;
  // How many rows this device changed that the server has not had yet.
  pending_changes: number;
  error: string;
}

export function is_change_list(value: unknown): value is SyncChange[] {
  return Array.isArray(value) && value.every((change) => typeof change === "object" && change !== null && "table" in change && "key" in change);
}

// ── Device calls ─────────────────────────────────────────────────────────────

// What a page asks of a device that keeps its own copy; a browser has none, since it is already on the server.
export interface SyncDeviceMethods {
  get_sync_status: () => SyncStatus;
  // Signs in with a name and password, takes a token given by hand, or keeps the saved sign-in when given null.
  connect_sync: (server_url: string, credentials: SyncCredentials | string | null, direction: SyncDirection) => Promise<SyncStatus>;
  disconnect_sync: () => SyncStatus;
  sync_now: () => Promise<SyncStatus>;
}

export const sync_device_method_names = ["get_sync_status", "connect_sync", "disconnect_sync", "sync_now"] as const satisfies readonly (keyof SyncDeviceMethods)[];

// The same calls as the page makes them, each answered later, as a bridge's client gives them.
export type SyncDeviceClient = { [Name in keyof SyncDeviceMethods]: (...args: Parameters<SyncDeviceMethods[Name]>) => Promise<Awaited<ReturnType<SyncDeviceMethods[Name]>>> };
