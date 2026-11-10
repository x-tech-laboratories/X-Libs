// The sync client's server and token kept in a JSON file on Node, such as beside a desktop app's database, so a scratch
// database never syncs with the real server. Only this user can read the file, since it holds the token.

// ── Imports ──────────────────────────────────────────────────────────────────

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SyncConfig, SyncStorage } from "./sync_client.ts";

// ── Storage ──────────────────────────────────────────────────────────────────

export interface FileSyncStorageOptions {
  // The JSON file, such as "<profile>/sync.json"; its folder is made when missing.
  file: string;
  // Runs before the server's copy replaces the local one, such as to back the database up.
  back_up_before_download: () => void | Promise<void>;
}

export function file_sync_storage({ file, back_up_before_download }: FileSyncStorageOptions): SyncStorage {
  return {
    read_config: () => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SyncConfig) : null),
    write_config: (config) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
      // The mode above only applies to a new file, so one left looser before is tightened too.
      chmodSync(file, 0o600);
    },
    remove_config: () => rmSync(file, { force: true }),
    back_up_before_download,
  };
}
