// The daemons a desktop app connects to, kept in a JSON file in its profile folder. Only this user can read the file,
// since it holds each daemon's token.

// ── Imports ──────────────────────────────────────────────────────────────────

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ConnectionStorage, SavedConnections } from "./connections.ts";

// ── Storage ──────────────────────────────────────────────────────────────────

// The file, such as "<profile>/connections.json"; its folder is made when missing.
export function connection_file_storage(file: string): ConnectionStorage {
  return {
    read: () => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SavedConnections) : null),
    write: (saved) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
      // The mode above only applies to a new file, so one left looser before is tightened too.
      chmodSync(file, 0o600);
    },
  };
}
