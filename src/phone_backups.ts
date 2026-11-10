// Backups on a phone, kept in a folder the user picks once in its storage, where file managers and sync apps reach them.
// The folder lives on the Android side, in X-Libs' XLibsBackupFolder plugin, and each file crosses the bridge as base64.

// ── Imports ──────────────────────────────────────────────────────────────────

import { registerPlugin } from "@capacitor/core";

import { backups, type BackupNaming, type Backups } from "./backups.ts";
import type { SqlDatabase } from "./sql.ts";

// ── Plugin ───────────────────────────────────────────────────────────────────

export interface BackupFolderPlugin {
  // The picked folder's name, or "" while none is picked or the phone took the permission back.
  get_folder: () => Promise<{ name: string }>;
  // Opens Android's folder picker; backing out keeps the folder there was.
  choose_folder: () => Promise<{ name: string }>;
  list: () => Promise<{ files: { name: string; size_bytes: number }[] }>;
  write: (options: { name: string; data: string }) => Promise<void>;
  read: (options: { name: string }) => Promise<{ data: string }>;
  remove: (options: { name: string }) => Promise<void>;
}

export const backup_folder_plugin = registerPlugin<BackupFolderPlugin>("XLibsBackupFolder");

const base64_chunk_bytes = 0x8000;

export function to_base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += base64_chunk_bytes) binary += String.fromCharCode(...bytes.subarray(start, start + base64_chunk_bytes));
  return btoa(binary);
}

export function from_base64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

// ── Backups ──────────────────────────────────────────────────────────────────

// The phone's database as web/sqlite_wasm opens it.
export interface PhoneDatabase {
  connection: SqlDatabase;
  export_bytes: () => Uint8Array;
  replace_with: (bytes: Uint8Array) => void;
  save_now: () => Promise<void>;
}

export interface PhoneBackupsOptions {
  naming: BackupNaming;
  database: PhoneDatabase;
  // Runs on the restored data before it is saved, such as bringing it up to date and the sync engine's forget_history.
  after_restore?: (database: SqlDatabase) => void;
  // The folder's side; the Android plugin unless set, such as in a test.
  folder?: BackupFolderPlugin;
}

export interface PhoneBackups extends Backups {
  // Backs up the current data first, so a restore can itself be undone.
  restore: (name: string) => Promise<void>;
  // The picked folder's name, or "" before one is picked; there are no backups until then.
  folder_name: () => Promise<string>;
  choose_folder: () => Promise<string>;
}

// Backups work as on a desktop, but in the picked folder; until one is picked the list is empty and daily ones wait.
export function phone_backups({ naming, database, after_restore, folder = backup_folder_plugin }: PhoneBackupsOptions): PhoneBackups {
  const folder_name = async (): Promise<string> => (await folder.get_folder()).name;

  const kept = backups(naming, {
    list: async () => ((await folder_name()) ? (await folder.list()).files : []),
    take: async (name) => {
      const bytes = database.export_bytes();
      await folder.write({ name, data: to_base64(bytes) });
      return bytes.byteLength;
    },
    remove: (name) => folder.remove({ name }),
  });

  const restore = async (name: string): Promise<void> => {
    if (!naming.pattern.test(name)) throw new Error(`not a backup name: ${name}`);
    const { data } = await folder.read({ name });
    await kept.create();
    database.replace_with(from_base64(data));
    after_restore?.(database.connection);
    await database.save_now();
  };

  // keep_backing_up calls this every hour, so it waits quietly until a folder is picked.
  const keep_automatic: Backups["keep_automatic"] = async (to_keep, interval_in_milliseconds, now) => {
    if (await folder_name()) await kept.keep_automatic(to_keep, interval_in_milliseconds, now);
  };

  return { ...kept, keep_automatic, restore, folder_name, choose_folder: async () => (await folder.choose_folder()).name };
}
