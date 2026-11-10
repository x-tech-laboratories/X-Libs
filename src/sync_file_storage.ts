// Where a desktop app or server keeps the sync server and its token: a JSON file only its own user can read.

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { SyncConfig, SyncStorage } from "./sync_protocol.ts";

export function sync_file_storage(file: string, back_up_before_download: SyncStorage["back_up_before_download"]): SyncStorage {
  return {
    read_config: () => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SyncConfig) : null),
    // The mode is set again, since writeFileSync keeps the mode of a file already there.
    write_config: (config) => {
      writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
      chmodSync(file, 0o600);
    },
    remove_config: () => rmSync(file, { force: true }),
    back_up_before_download,
  };
}
