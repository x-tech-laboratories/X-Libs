// Files that sync beside an app's rows, such as covers or photos: each is named by the sha256 of its bytes, a synced
// column holds the name, and the sync client moves the files those rows name between the device and the server. Rows
// stay small, so a large picture never travels with every change.

// ── Store ────────────────────────────────────────────────────────────────────

// Where a host keeps the files: a folder on Node (`folder_file_store`), IndexedDB on a phone (`indexed_db_files`).
export interface SyncFileStore {
  read: (name: string) => Promise<Uint8Array | undefined>;
  write: (name: string, bytes: Uint8Array) => Promise<void>;
  has: (name: string) => Promise<boolean>;
}

// ── Names ────────────────────────────────────────────────────────────────────

const file_name_pattern = /^[0-9a-f]{64}$/;

// A file's name is the sha256 of its bytes in lowercase hex.
export function is_file_name(name: unknown): name is string {
  return typeof name === "string" && file_name_pattern.test(name);
}

export async function hash_bytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Keeps the bytes under their hash and gives the name to store in a row.
export async function put_file(store: SyncFileStore, bytes: Uint8Array): Promise<string> {
  const name = await hash_bytes(bytes);
  if (!(await store.has(name))) await store.write(name, bytes);
  return name;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export interface SyncFilesOptions<Database> {
  store: SyncFileStore;
  // Every file name the rows hold, such as each cover's column; empty names are skipped.
  referenced: (database: Database) => string[];
}

// What a device sends to learn which of its files the server lacks.
export interface SyncFilesMissingRequest {
  names: string[];
}

export interface SyncFilesMissingResponse {
  missing: string[];
}
