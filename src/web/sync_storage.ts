// Where a phone's page keeps the sync server and its token: the app's own local storage, which no other app can read.

import type { SyncConfig, SyncStorage } from "../sync_protocol.ts";

export function local_sync_storage(key: string, back_up_before_download: SyncStorage["back_up_before_download"]): SyncStorage {
  return {
    read_config: () => {
      const saved = localStorage.getItem(key);
      return saved ? (JSON.parse(saved) as SyncConfig) : null;
    },
    write_config: (config) => localStorage.setItem(key, JSON.stringify(config)),
    remove_config: () => localStorage.removeItem(key),
    back_up_before_download,
  };
}
