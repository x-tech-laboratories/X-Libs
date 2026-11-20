// Where a phone's page keeps the daemons it connects to and their tokens: the app's own local storage, which no other app can read.

import type { ConnectionStorage, SavedConnections } from "../connection_protocol.ts";

// The local storage key, such as "x-tasks-connections".
export function local_connection_storage(key: string): ConnectionStorage {
  return {
    read: () => {
      const saved = localStorage.getItem(key);
      return saved ? (JSON.parse(saved) as SavedConnections) : null;
    },
    write: (saved) => localStorage.setItem(key, JSON.stringify(saved)),
  };
}
