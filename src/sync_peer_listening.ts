// A desktop daemon's "Let other devices connect": off until the user turns it on, then a port of its own that paired
// devices reach it on, announced on the local network. The setting belongs to this computer, so it is kept in a file
// beside the database, never synced. Paired devices are found on the network either way.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { listen_for_peers, type PeerListener } from "./server/sync_peer_routes.ts";
import type { SyncPeer } from "./sync_peer.ts";
import { discover_peers, type PeerDiscovery } from "./sync_peer_discovery.ts";
import type { PeerListening, PeerListeningMethods } from "./sync_protocol.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface PeerListeningOptions {
  // The sync peer, asked for only once listening starts, since the peer itself asks this for its addresses.
  peer: () => SyncPeer;
  app: string;
  // The JSON file, such as "<profile>/sync-listening.json".
  file: string;
  default_port: number;
  // A test hands in its own; the real ones unless set.
  listen?: typeof listen_for_peers;
  discover?: typeof discover_peers;
}

interface SavedListening {
  on: boolean;
  port: number;
}

export type PeerListeningControl = ReturnType<typeof keep_listening_for_peers>;

// ── Listening ────────────────────────────────────────────────────────────────

export function keep_listening_for_peers(options: PeerListeningOptions) {
  const listen = options.listen ?? listen_for_peers;
  const discover = options.discover ?? discover_peers;
  let listener: PeerListener | null = null;
  let discovery: PeerDiscovery | null = null;
  let error = "";

  // A missing or damaged file reads as off on the default port.
  function read_saved(): SavedListening {
    try {
      const saved = existsSync(options.file) ? (JSON.parse(readFileSync(options.file, "utf8")) as Partial<SavedListening>) : {};
      const port = Number.isInteger(saved.port) && saved.port! > 0 && saved.port! < 65536 ? saved.port! : options.default_port;
      return { on: saved.on === true, port };
    } catch {
      return { on: false, port: options.default_port };
    }
  }

  async function close(): Promise<void> {
    discovery?.stop();
    discovery = null;
    await listener?.close();
    listener = null;
  }

  // Opens or closes the port as the setting says; a port that cannot be opened is reported, and devices are still looked for.
  async function apply(): Promise<void> {
    await close();
    const saved = read_saved();
    error = "";
    if (saved.on) {
      try {
        listener = await listen({ peer: options.peer(), port: saved.port });
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
    }
    discovery = discover({ peer: options.peer(), app: options.app, port: listener?.port });
  }

  function addresses(): string[] {
    return listener?.addresses() ?? [];
  }

  function get_peer_listening(): PeerListening {
    const saved = read_saved();
    return { ...saved, addresses: addresses(), error };
  }

  const methods: PeerListeningMethods = {
    get_peer_listening,
    set_peer_listening: async (on, port) => {
      const next: SavedListening = { on, port: port ?? read_saved().port };
      if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new Error("the port must be a whole number from 1 to 65535");
      mkdirSync(dirname(options.file), { recursive: true });
      writeFileSync(options.file, JSON.stringify(next, null, 2));
      await apply();
      return get_peer_listening();
    },
  };

  return { start: apply, stop: close, addresses, methods };
}
