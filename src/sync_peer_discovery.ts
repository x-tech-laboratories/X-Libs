// Finding paired devices on the local network by mDNS, on bonjour-service, so a laptop that moved to another address or
// network is reached again without anyone typing it: each listening device announces its app and device id, and each
// device hands the addresses it hears of to its sync peer, which still only talks to devices it is paired with.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Bonjour, type Service } from "bonjour-service";

import type { SyncPeer } from "./sync_peer.ts";

// ── Discovery ────────────────────────────────────────────────────────────────

export const sync_service_type = "x-sync";

export interface PeerDiscoveryOptions {
  peer: Pick<SyncPeer, "device" | "found_address">;
  app: string;
  // The port this device answers other devices on; it only listens for others when unset.
  port?: number;
  // A test hands in its own; one on the local network unless set.
  bonjour?: Pick<Bonjour, "publish" | "find" | "destroy">;
}

export interface PeerDiscovery {
  stop: () => void;
}

// The address a found service answers at, preferring IPv4, which every device on a home network can reach.
export function address_of_service(service: Pick<Service, "addresses" | "port" | "referer">): string | null {
  const candidates = [...(service.addresses ?? []), ...(service.referer ? [service.referer.address] : [])];
  const chosen = candidates.find((address) => !address.includes(":")) ?? candidates.find((address) => !address.toLowerCase().startsWith("fe80"));
  if (!chosen) return null;
  return chosen.includes(":") ? `http://[${chosen}]:${service.port}/` : `http://${chosen}:${service.port}/`;
}

export function discover_peers(options: PeerDiscoveryOptions): PeerDiscovery {
  const bonjour = options.bonjour ?? new Bonjour();
  if (options.port !== undefined) {
    bonjour.publish({ name: `${options.app}-${options.peer.device}`, type: sync_service_type, port: options.port, txt: { app: options.app, device: options.peer.device } });
  }
  const browser = bonjour.find({ type: sync_service_type }, (service) => {
    const txt = (service.txt ?? {}) as { app?: unknown; device?: unknown };
    if (txt.app !== options.app || typeof txt.device !== "string" || txt.device === options.peer.device) return;
    const address = address_of_service(service);
    if (address) options.peer.found_address(txt.device, address);
  });
  return {
    stop: () => {
      browser.stop();
      bonjour.destroy();
    },
  };
}
