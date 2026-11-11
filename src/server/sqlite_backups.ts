// Backups of an app's SQLite database as files in a folder, for a desktop app's main process or a server: each is a
// clean copy written by VACUUM INTO, and a restore puts one back in place of the database file. A server whose
// connection others hold stages the restore instead, and takes it in on its next start, before it opens the database.

import { copyFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { backups, type BackupNaming, type Backups } from "../backups.ts";
import type { SqlDatabase } from "../sql.ts";
import { backup_path, file_backup_store } from "./backup_files.ts";

export interface SqliteBackupOptions {
  folder: () => string;
  naming: BackupNaming;
  database: () => SqlDatabase;
  database_path: () => string;
  // Closes the open connection before the file is replaced and opens it again after, migrations and triggers included.
  // Without them the restore is staged for the next start, as a server does.
  close?: () => void;
  open?: () => void;
  // Runs on the reopened database, such as the sync engine's forget_history, since the data no longer matches other devices'.
  after_restore?: (database: SqlDatabase) => void;
  // Runs once a restore is staged, such as stopping the server so its supervisor starts it again.
  after_staging?: () => void;
}

export interface SqliteBackups extends Backups {
  restore: (name: string) => Promise<void>;
}

// Where a staged restore waits beside the database.
export function staged_restore_path(database_path: string): string {
  return `${database_path}.restore`;
}

// Puts a staged restore in place of the database; run it before opening the database. Returns whether there was one.
export function take_staged_restore(database_path: string): boolean {
  const staged = staged_restore_path(database_path);
  if (!existsSync(staged)) return false;
  rmSync(`${database_path}-wal`, { force: true });
  rmSync(`${database_path}-shm`, { force: true });
  renameSync(staged, database_path);
  return true;
}

export function sqlite_backups(options: SqliteBackupOptions): SqliteBackups {
  const copy_to = (path: string) => void options.database().prepare("VACUUM INTO ?").run(path);
  const kept = backups(options.naming, file_backup_store(options.folder, options.naming, copy_to));

  // The current data is backed up first, so a restore can itself be undone.
  const restore = async (name: string): Promise<void> => {
    const source = backup_path(options.folder(), options.naming, name);
    statSync(source);
    await kept.create();

    const target = options.database_path();
    const { close, open } = options;
    if (!close || !open) {
      copyFileSync(source, staged_restore_path(target));
      options.after_staging?.();
      return;
    }
    close();
    try {
      rmSync(`${target}-wal`, { force: true });
      rmSync(`${target}-shm`, { force: true });
      copyFileSync(source, target);
    } finally {
      open();
    }
    options.after_restore?.(options.database());
  };

  return { ...kept, restore };
}
