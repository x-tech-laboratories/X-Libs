// A table of calls served over HTTP, as a desktop app's daemon and a web server both answer them: POST <path>/<method>
// with the arguments as a JSON list, every answer sent as JSON, and the other pages told after any call that changes data.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest } from "fastify";

import { default_client_id_header } from "./events.ts";
import { send_text } from "./replies.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface CallTableOptions {
  // Whether a call only reads, so it announces nothing and is not cached by a browser.
  is_read_only: (method: string) => boolean;
  // Runs after a call that changes data, with the client id of the page that made it, or "" for none.
  on_change?: (client_id: string, method: string, request: FastifyRequest) => void;
  // The header a page sends its client id in; X-Libs' event stream's unless set.
  client_id_header?: string;
  // The largest body taken, such as for an import arriving as one call's argument; Fastify's own unless set.
  body_limit?: number;
}

// ── Route ────────────────────────────────────────────────────────────────────

// A name that is not the table's own, such as toString, is refused like any other missing call.
export function register_call_table(api: FastifyInstance, path: string, methods: object, options: CallTableOptions): void {
  const header = options.client_id_header ?? default_client_id_header;
  const route_options = options.body_limit === undefined ? {} : { bodyLimit: options.body_limit };
  api.post<{ Params: { method: string } }>(`${path}/:method`, route_options, async (request, reply) => {
    const { method } = request.params;
    if (!Object.hasOwn(methods, method)) return send_text(reply, 404, `no call named ${method}`);
    const body: unknown = request.body ?? [];
    if (!Array.isArray(body)) return send_text(reply, 400, "send the arguments as a JSON list");

    const result: unknown = await (methods as Record<string, (...args: unknown[]) => unknown>)[method]!(...body);
    const is_read_only = options.is_read_only(method);
    if (!is_read_only) options.on_change?.(String(request.headers[header] ?? ""), method, request);

    if (result === undefined) return reply.code(204).send();
    if (is_read_only) reply.header("cache-control", "no-store");
    // Fastify would send a string as bare text, which the caller could not tell from JSON.
    return reply.type("application/json").send(JSON.stringify(result));
  });
}
