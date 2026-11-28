// The phone's page: it keeps its own database, answers its calls on it, and syncs with the devices it is paired with.
// Only the phone build loads it, so a browser never fetches SQLite.

// ── Imports ──────────────────────────────────────────────────────────────────

import { App as CapacitorApp } from "@capacitor/app";

import { keep_backing_up } from "../../backups.ts";
import type { Client } from "../../electron/bridge.ts";
import { phone_backups, type BackupFolderPlugin } from "../../phone_backups.ts";
import { phone_certificates } from "../../phone_certificates.ts";
import { create_sync_peer, sync_device_methods } from "../../sync_peer.ts";
import { indexed_db_files, open_wasm_database, type FileStore } from "../../web/sqlite_wasm.ts";
import { local_sync_storage } from "../../web/sync_storage.ts";
import type { App } from "../define.ts";
import type { PageApi } from "../protocol.ts";

// ── Api ──────────────────────────────────────────────────────────────────────

// The phone's comings and goings.
export interface PhoneLifecycle {
  addListener(event: "pause", listener: () => void): unknown;
  addListener(event: "resume", listener: () => void): unknown;
}

// The phone's own unless a test hands in its own.
export interface PhoneOptions {
  lifecycle?: PhoneLifecycle;
  files?: FileStore;
  folder?: BackupFolderPlugin;
}

// Each call runs straight on the database in this page; answers are promises, as they are on the other hosts.
function as_client<Methods extends { [Name in keyof Methods]: (...args: never[]) => unknown }>(methods: Methods): Client<Methods> {
  const entries = Object.entries(methods as Record<string, (...args: never[]) => unknown>).map(([name, method]) => [name, async (...args: never[]) => method(...args)]);
  return Object.fromEntries(entries) as Client<Methods>;
}

export async function android_api(app: App, options: PhoneOptions = {}): Promise<PageApi> {
  const lifecycle = options.lifecycle ?? CapacitorApp;
  const files = options.files ?? indexed_db_files(app.id);
  const database = await open_wasm_database({ files, file_name: app.database_file });

  // Backups go in a folder the user picks; a restored copy is brought up to date and sync asks again which copy wins.
  const kept = phone_backups({
    naming: app.backup_naming,
    database,
    ...(options.folder ? { folder: options.folder } : {}),
    after_restore: (restored) => {
      app.open_store(restored);
      app.sync_engine.forget_history(restored);
    },
  });
  const has_folder = async () => (await kept.folder_name()) !== "";

  // An upgrade is backed up first when there is a folder, since it cannot be undone any other way.
  if (app.needs_upgrade(database.connection) && (await has_folder())) await kept.create();
  app.open_store(database.connection);
  await database.save_now();
  const keeper = keep_backing_up(kept, () => app.read_backup_schedule(database.connection));

  const listeners = new Set<() => void>();
  const announce = (): void => {
    for (const listener of listeners) listener();
  };

  // The paired devices and keys stay in the app's private storage; before another copy replaces this one the data is
  // backed up to the folder, or beside the database while there is none.
  const before_sync_file = app.database_file.replace(/\.db$/, "") + "-before-sync.db";
  const back_up_before_replace = async () => ((await has_folder()) ? void (await kept.create()) : files.write(before_sync_file, database.export_bytes()));
  const storage = local_sync_storage({ key: `${app.id}-sync-peers`, back_up_before_replace });
  const sync = create_sync_peer({ app: app.id, engine: app.sync_engine, database: () => database.connection, storage, device_name: `${app.name} on Android`, on_remote_change: announce });

  // A phone may close the app at any moment once it is in the background, so the database is saved straight away.
  lifecycle.addListener("pause", () => void database.save_now());
  lifecycle.addListener("resume", () => void sync.sync_now());
  sync.start();

  return {
    host: "android",
    calls: as_client(app.bind_methods(() => database.connection, () => undefined)) as PageApi["calls"],
    device: as_client(sync_device_methods(sync)),
    certificates: phone_certificates(),
    backups: as_client(app.backup_methods(kept, () => database.connection, () => void keeper.check())),
    backup_folder: {
      name: kept.folder_name,
      // A first daily backup is taken as soon as a folder is picked.
      choose: async () => {
        const name = await kept.choose_folder();
        await keeper.check();
        return name;
      },
    },
    on_change: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
