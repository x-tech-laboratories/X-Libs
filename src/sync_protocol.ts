// What paired devices send each other to keep one app's SQLite data alike on all of them, with no server: every value
// of every synced row travels on its own with the version that decides which device's write wins, each device passes
// on what it took from the others, and every call between two devices is sealed with both devices' keys.

// ── Changes ──────────────────────────────────────────────────────────────────

// One value of one row; the later time wins, then the larger site id.
export interface SyncChange {
  table: string;
  key: string;
  column: string;
  value: unknown;
  ts: number;
  site: string;
}

export function is_change_list(value: unknown): value is SyncChange[] {
  return Array.isArray(value) && value.every((change) => typeof change === "object" && change !== null && "table" in change && "key" in change);
}

// ── Devices ──────────────────────────────────────────────────────────────────

// This device's keys, made once and kept outside the synced data.
export interface PeerIdentity {
  device: string;
  public_key: string;
  secret_key: string;
}

// A device's id in groups of eight letters, as the settings show it.
export function format_device_id(device: string): string {
  return device.match(/.{1,8}/g)?.join("-") ?? device;
}

// A device of the group as every member knows it; the newer entry wins when two devices' copies differ.
export interface PeerRecord {
  device: string;
  public_key: string;
  // What the device calls itself, such as "X-Tasks on laptop".
  name: string;
  // Where the device answers other devices, such as "http://192.168.1.5:3920/"; empty when it only reaches out.
  addresses: string[];
  updated_at: number;
  // Removed from the group, kept so the removal reaches every device.
  removed: boolean;
}

// Where each platform keeps this device's keys and the group, and how it saves a copy before another copy replaces the data.
export interface PeerStorage {
  read_identity: () => PeerIdentity | null;
  write_identity: (identity: PeerIdentity) => void;
  read_peers: () => PeerRecord[];
  write_peers: (peers: PeerRecord[]) => void;
  back_up_before_replace: () => void | Promise<void>;
}

// ── Calls between devices ────────────────────────────────────────────────────

// Under the address a device answers at.
export const sync_peer_path = "sync/peer";
export const peer_device_header = "x-sync-device";
// Sent only while pairing, when the other device does not know this one's key yet.
export const peer_key_header = "x-sync-key";

// A device names the other's changes it has by the other's generation and counter.
export interface PeerCursor {
  generation: string;
  seq: number;
}

export interface PeerExchangeRequest {
  site: string;
  generation: string;
  // How far this device has taken the other's changes.
  cursor: PeerCursor;
  changes: SyncChange[];
  // This device's counter the changes were read at.
  up_to_seq: number;
  // Set when the changes make the other's data match this device's, as after a restore, so it keeps a copy first.
  replaces: boolean;
  peers: PeerRecord[];
}

export interface PeerExchangeResponse {
  site: string;
  generation: string;
  changes: SyncChange[];
  up_to_seq: number;
  peers: PeerRecord[];
}

export interface PeerSnapshot {
  site: string;
  generation: string;
  changes: SyncChange[];
  up_to_seq: number;
}

// Each call a device answers, with what it takes and gives.
export interface PeerCalls {
  pair: { args: { secret: string; me: PeerRecord }; result: { me: PeerRecord; peers: PeerRecord[] } };
  exchange: { args: PeerExchangeRequest; result: PeerExchangeResponse };
  snapshot: { args: Record<string, never>; result: PeerSnapshot };
  // Answers once the device has changes past the cursor, or after the wait.
  wait: { args: { cursor: PeerCursor; wait_ms: number }; result: { changed: boolean } };
  files_missing: { args: { names: string[] }; result: { missing: string[] } };
  file_get: { args: { name: string }; result: { found: boolean } };
  file_put: { args: { name: string }; result: { kept: boolean } };
}

export type PeerCallName = keyof PeerCalls;

// What goes inside a sealed call: who it is for and when it was made, so it cannot be replayed to another device or later.
export interface PeerCallBody {
  to: string;
  at: number;
  call: PeerCallName;
  args: unknown;
}

// What goes inside a sealed answer: the call it answers, and either its result or why it was refused.
export interface PeerAnswerBody {
  reply_to: string;
  result?: unknown;
  error?: string;
}

// ── Pairing ──────────────────────────────────────────────────────────────────

// What a pairing code carries, so the device typing it can reach this one and knows its key.
export interface PairingOffer {
  app: string;
  device: string;
  public_key: string;
  name: string;
  addresses: string[];
  secret: string;
}

export interface PairingCode {
  code: string;
  expires_at: string;
}

// ── Device status ────────────────────────────────────────────────────────────

// Off with no paired device.
export type SyncState = "off" | "idle" | "syncing" | "offline" | "failed";

export type PeerState = "idle" | "syncing" | "offline" | "failed";

export interface PeerStatus {
  device: string;
  name: string;
  addresses: string[];
  state: PeerState;
  // When the last exchange with this device finished, as an ISO time; empty if never.
  last_synced_at: string;
  error: string;
}

export interface SyncStatus {
  state: SyncState;
  device: string;
  name: string;
  // Where other devices can reach this one; empty when it only reaches out.
  addresses: string[];
  peers: PeerStatus[];
  last_synced_at: string;
  // How many rows this device changed that some paired device has not had yet.
  pending_changes: number;
  error: string;
}

// ── Device calls ─────────────────────────────────────────────────────────────

// What a page asks of the app that keeps its copy, such as through Electron's preload or a phone's bridge.
export interface SyncDeviceMethods {
  get_sync_status: () => SyncStatus;
  // A one-time code another device enters to pair with this one; refused when no other device can reach this one.
  create_pairing_code: () => PairingCode;
  // Pairs with the device that made the code; the two copies merge, the newest write of each value winning.
  pair_device: (code: string) => Promise<SyncStatus>;
  remove_device: (device: string) => SyncStatus;
  sync_now: () => Promise<SyncStatus>;
}

export const sync_device_method_names = [
  "get_sync_status",
  "create_pairing_code",
  "pair_device",
  "remove_device",
  "sync_now",
] as const satisfies readonly (keyof SyncDeviceMethods)[];

// The same calls as the page makes them, each answered later, as a bridge's client gives them.
export type SyncDeviceClient = { [Name in keyof SyncDeviceMethods]: (...args: Parameters<SyncDeviceMethods[Name]>) => Promise<Awaited<ReturnType<SyncDeviceMethods[Name]>>> };

// ── Listening ────────────────────────────────────────────────────────────────

// Whether a desktop daemon lets other devices reach it, on which port, and where they reach it.
export interface PeerListening {
  on: boolean;
  port: number;
  addresses: string[];
  // Why the port could not be opened, such as another program holding it; empty when it opened.
  error: string;
}

export interface PeerListeningMethods {
  get_peer_listening: () => PeerListening;
  set_peer_listening: (on: boolean, port?: number) => Promise<PeerListening>;
}

export const peer_listening_method_names = ["get_peer_listening", "set_peer_listening"] as const satisfies readonly (keyof PeerListeningMethods)[];

export type PeerListeningClient = { [Name in keyof PeerListeningMethods]: (...args: Parameters<PeerListeningMethods[Name]>) => Promise<Awaited<ReturnType<PeerListeningMethods[Name]>>> };
