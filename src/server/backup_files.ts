// Backups kept as files in a folder on disk, for an app's main process or server.

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BackupNaming, BackupStore } from "../backups.ts";

// The path of a backup in the folder, refusing any name the naming did not write.
export function backup_path(folder: string, naming: BackupNaming, name: string): string {
  if (!naming.pattern.test(name)) throw new Error(`not a backup name: ${name}`);
  return join(folder, name);
}

// A folder of backup files, made when first used; copy_to writes the app's data to the path it is given, such as through SQLite's own backup.
export function file_backup_store(folder: () => string, naming: BackupNaming, copy_to: (path: string) => void): BackupStore {
  const path_of = (name: string) => backup_path(folder(), naming, name);
  return {
    list: () => {
      mkdirSync(folder(), { recursive: true });
      return readdirSync(folder()).filter((name) => naming.pattern.test(name)).map((name) => ({ name, size_bytes: statSync(path_of(name)).size }));
    },
    take: (name) => {
      mkdirSync(folder(), { recursive: true });
      copy_to(path_of(name));
      return statSync(path_of(name)).size;
    },
    remove: (name) => rmSync(path_of(name)),
  };
}
