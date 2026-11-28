// The listening half of a sync peer on Fastify: the one route other devices send their sealed calls to, and a small
// listener of its own for a desktop daemon that otherwise answers only on its Unix socket. Every call is sealed between
// the two devices, so the route needs no sign-in and may be served over plain http on a home network.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";

import fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { SyncPeer } from "../sync_peer.ts";
import { peer_device_header, peer_key_header, sync_peer_path } from "../sync_protocol.ts";
import { register_open_cors } from "./cors.ts";
import { send_text } from "./replies.ts";

// ── Routes ───────────────────────────────────────────────────────────────────

// The headers a phone's page sends with its calls, for an app that registers its own open CORS.
export const sync_peer_headers = [peer_device_header, peer_key_header];

export interface SyncPeerRoutesOptions {
  // A device sending every row it holds needs room; 256 MiB unless set.
  body_limit?: number;
}

// Served at "/sync/peer" under the plugin's prefix, so an address such as "https://tasks.example.org/api/" reaches it.
export function register_sync_peer_routes(app: FastifyInstance, peer: SyncPeer, options: SyncPeerRoutesOptions = {}): void {
  const body_limit = options.body_limit ?? 256 * 1024 * 1024;
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: body_limit }, (_request, body, done) => done(null, body));
  }

  app.post(`/${sync_peer_path}`, { bodyLimit: body_limit }, async (request, reply) => {
    const device = request.headers[peer_device_header];
    const key = request.headers[peer_key_header];
    if (typeof device !== "string" || !Buffer.isBuffer(request.body)) return send_text(reply, 400, "send a sealed call as application/octet-stream");
    const answered = await peer.answer({ device, key: typeof key === "string" ? key : undefined, body: new Uint8Array(request.body) });
    if (typeof answered.body === "string") return send_text(reply, answered.status, answered.body);
    return reply.code(answered.status).header("content-type", "application/octet-stream").send(Buffer.from(answered.body));
  });
}

// ── Listener ─────────────────────────────────────────────────────────────────

export interface PeerListenerOptions {
  peer: SyncPeer;
  // Every network unless set.
  host?: string;
  port: number;
  body_limit?: number;
  // The certificate and key it serves https with; plain http without them, which only a test or a trusted tunnel should use.
  https?: { cert: string; key: string };
}

export interface PeerListener {
  close: () => Promise<void>;
  // The port it listens on, the one the system chose when asked for 0.
  port: number;
  // The addresses other devices may reach this one at, one per network address the computer has.
  addresses: () => string[];
}

// The computer's own addresses other devices on its networks can reach, leaving out loopback and link-local ones.
export function reachable_addresses(port: number, interfaces = networkInterfaces(), scheme: "http" | "https" = "http"): string[] {
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || (entry.family === "IPv6" && entry.address.toLowerCase().startsWith("fe80"))) continue;
      found.push(entry.family === "IPv6" ? `${scheme}://[${entry.address}]:${port}/` : `${scheme}://${entry.address}:${port}/`);
    }
  }
  return found;
}

// A desktop daemon's port for other devices, opened only once the user lets other devices connect.
export async function listen_for_peers(options: PeerListenerOptions): Promise<PeerListener> {
  const app = fastify({ forceCloseConnections: true, ...(options.https ? { https: options.https } : {}) } as FastifyServerOptions);
  await register_open_cors(app, { allowed_headers: sync_peer_headers });
  register_sync_peer_routes(app, options.peer, { body_limit: options.body_limit });
  await app.listen({ host: options.host ?? "::", port: options.port });
  const port = (app.server.address() as AddressInfo).port;
  const scheme = options.https ? "https" : "http";
  return { close: () => app.close(), port, addresses: () => reachable_addresses(port, networkInterfaces(), scheme) };
}
