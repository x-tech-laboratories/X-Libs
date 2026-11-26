// The WebSocket agents dial in on. The upgrade names the host, by the header an agent logging in with its key sends or
// by the token in its Authorization header, so an unknown one is refused before any socket opens, as is one past the
// hub's limit on sockets still logging in.

// ── Imports ──────────────────────────────────────────────────────────────────

import fastify_websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ServerSocket } from "./connection.ts";
import { pre_login_message_limit_in_bytes, too_many_pending_logins, type AgentHub, type AgentLogin } from "./hub.ts";

// A run's output can be large, so one message after login may be up to this size.
const largest_message_in_bytes = 64 * 1024 * 1024;

// ── Route ────────────────────────────────────────────────────────────────────

// Refuses an upgrade the hub does not admit, or one past the hub's limit on sockets still logging in, before any socket opens; a socket's messages are held to the pre-login size until its hello is accepted.
export async function register_agent_route<Task>(app: FastifyInstance, hub: AgentHub<Task>, path = "/api/agent"): Promise<void> {
  await app.register(fastify_websocket, { options: { maxPayload: largest_message_in_bytes } });
  const admitted = new WeakMap<FastifyRequest, { host: string; login: AgentLogin; release: () => void }>();

  app.get(path, {
    websocket: true,
    preValidation: async (request, reply) => {
      const admission = hub.admit(request.headers);
      if ("error" in admission) {
        request.log.info({ reason: admission.reason }, "Refused an agent's upgrade");
        return reply.code(401).send({ error: admission.error });
      }
      const release = hub.hold_pending_login(request.ip);
      if (release === null) return reply.code(503).send({ error: too_many_pending_logins });
      // The place is given back when the connection ends, even if the upgrade never completes.
      request.raw.socket.once("close", release);
      admitted.set(request, { ...admission, release });
    },
  }, (socket, request) => {
    const { host, login, release } = admitted.get(request)!;
    set_message_limit(socket, pre_login_message_limit_in_bytes);
    socket.on("close", release);
    hub.accept(socket as unknown as ServerSocket, host, login, {
      on_login: () => {
        release();
        set_message_limit(socket, largest_message_in_bytes);
      },
    });
  });

  app.addHook("onClose", async () => hub.close());
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Sets the largest frame the ws receiver takes on this socket, which it checks from a frame's header before reading its payload; without that receiver the hub still closes on an oversized message.
function set_message_limit(socket: unknown, limit_in_bytes: number): void {
  const receiver = (socket as { _receiver?: { _maxPayload?: unknown } })._receiver;
  if (receiver !== undefined && receiver !== null && typeof receiver._maxPayload === "number") receiver._maxPayload = limit_in_bytes;
}
