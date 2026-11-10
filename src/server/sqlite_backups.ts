// Backups of an app's SQLite database as files in a folder, for a desktop app's main process or a server: each is a
// clean copy written by VACUUM INTO, and a restore puts one back in place of the database file.

import { copyFileSync, rmSync, statSync } from "node:fs";
import { backups, type BackupNaming, type Backups } from "../backups.ts";
import type { SqlDatabase } from "../sql.ts";
import { backup_path, file_backup_store } from "./backup_files.ts";

export interface SqliteBackupOptions {
  folder: () => string;
  naming: BackupNaming;
  database: () => SqlDatabase;
  database_path: () => string;
  // Closes the open connection before the file is replaced and opens it again after, migrations and triggers included.
  close: () => void;
  open: () => void;
  // Runs on the reopened database, such as the sync engine's forget_history, since the data no longer matches other devices'.
  after_restore?: (database: SqlDatabase) => void;
}

export interface SqliteBackups extends Backups {
  restore: (name: string) => Promise<void>;
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
    options.close();
    try {
      rmSync(`${target}-wal`, { force: true });
      rmSync(`${target}-shm`, { force: true });
      copyFileSync(source, target);
    } finally {
      options.open();
    }
    options.after_restore?.(options.database());
  };

  return { ...kept, restore };
}
