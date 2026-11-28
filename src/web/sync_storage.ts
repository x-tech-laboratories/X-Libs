// Where a phone's page keeps its sync keys and paired devices: the app's own local storage, which no other app can read.

import type { PeerIdentity, PeerRecord, PeerStorage } from "../sync_protocol.ts";

export interface LocalSyncStorageOptions {
  // The local storage key, such as "x-tasks-sync-peers".
  key: string;
  // Runs before another device's changes replace this copy's data, such as to back the database up.
  back_up_before_replace: PeerStorage["back_up_before_replace"];
}

interface SavedPeers {
  identity?: PeerIdentity;
  peers?: PeerRecord[];
}

export function local_sync_storage({ key, back_up_before_replace }: LocalSyncStorageOptions): PeerStorage {
  function read(): SavedPeers {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as SavedPeers;
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }

  const write = (changes: SavedPeers) => localStorage.setItem(key, JSON.stringify({ ...read(), ...changes }));

  return {
    read_identity: () => read().identity ?? null,
    write_identity: (identity) => write({ identity }),
    read_peers: () => (Array.isArray(read().peers) ? read().peers! : []),
    write_peers: (peers) => write({ peers }),
    back_up_before_replace,
  };
}
