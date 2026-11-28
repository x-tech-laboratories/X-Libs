// A sync peer's keys and paired devices kept in a JSON file on Node, such as beside a desktop app's database, so a
// scratch database never syncs with the real devices. Only this user can read the file, since it holds the secret key.

// ── Imports ──────────────────────────────────────────────────────────────────

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { PeerIdentity, PeerRecord, PeerStorage } from "./sync_protocol.ts";

// ── Storage ──────────────────────────────────────────────────────────────────

export interface FileSyncStorageOptions {
  // The JSON file, such as "<profile>/sync-peers.json"; its folder is made when missing.
  file: string;
  // Runs before another device's changes replace this copy's data, such as to back the database up.
  back_up_before_replace: () => void | Promise<void>;
}

interface SavedPeers {
  identity?: PeerIdentity;
  peers?: PeerRecord[];
}

// A missing or unreadable file reads as no keys and no devices yet.
function read_saved(file: string): SavedPeers {
  try {
    const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SavedPeers) : {};
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function file_sync_storage({ file, back_up_before_replace }: FileSyncStorageOptions): PeerStorage {
  function write(changes: SavedPeers): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...read_saved(file), ...changes }, null, 2), { mode: 0o600 });
    // The mode above only applies to a new file, so one left looser before is tightened too.
    chmodSync(file, 0o600);
  }

  return {
    read_identity: () => read_saved(file).identity ?? null,
    write_identity: (identity) => write({ identity }),
    read_peers: () => (Array.isArray(read_saved(file).peers) ? read_saved(file).peers! : []),
    write_peers: (peers) => write({ peers }),
    back_up_before_replace,
  };
}
