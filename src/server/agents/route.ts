// The WebSocket agents dial in on. The upgrade names the host, by the header an agent logging in with its key sends or
// by the token in its Authorization header, so an unknown one is refused before any socket opens.

// ── Imports ──────────────────────────────────────────────────────────────────

import fastify_websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ServerSocket } from "./connection.ts";
import type { AgentHub, AgentLogin } from "./hub.ts";

// A run's output can be large, so one message may be up to this size.
const largest_message_in_bytes = 64 * 1024 * 1024;

// ── Route ────────────────────────────────────────────────────────────────────

export async function register_agent_route<Task>(app: FastifyInstance, hub: AgentHub<Task>, path = "/api/agent"): Promise<void> {
  await app.register(fastify_websocket, { options: { maxPayload: largest_message_in_bytes } });
  const admitted = new WeakMap<FastifyRequest, { host: string; login: AgentLogin }>();

  app.get(path, {
    websocket: true,
    preValidation: async (request, reply) => {
      const admission = hub.admit(request.headers);
      if ("error" in admission) return reply.code(401).send({ error: admission.error });
      admitted.set(request, admission);
    },
  }, (socket, request) => {
    const { host, login } = admitted.get(request)!;
    hub.accept(socket as unknown as ServerSocket, host, login);
  });

  app.addHook("onClose", async () => hub.close());
}
