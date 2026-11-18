// A folder of synced files on Node, such as a server's data folder or a desktop app's profile: one file per name,
// written beside itself first and then renamed, so a reader never sees half a file.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { is_file_name, type SyncFileStore } from "./sync_files.ts";

// ── Store ────────────────────────────────────────────────────────────────────

// The folder is made when missing; a name that is not a sha256 is refused, so no path can leave the folder.
export function folder_file_store(folder: string): SyncFileStore & { path_of: (name: string) => string } {
  const path_of = (name: string): string => {
    if (!is_file_name(name)) throw new Error(`${name} is not a file name`);
    return join(folder, name);
  };
  return {
    path_of,
    read: async (name) => (existsSync(path_of(name)) ? new Uint8Array(await readFile(path_of(name))) : undefined),
    write: async (name, bytes) => {
      mkdirSync(folder, { recursive: true });
      const partial = `${path_of(name)}.${crypto.randomUUID()}.partial`;
      await writeFile(partial, bytes);
      await rename(partial, path_of(name));
    },
    has: async (name) => existsSync(path_of(name)),
  };
}
