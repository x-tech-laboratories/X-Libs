// How a server answers what it could not do: every refusal in plain words, or as JSON { error }, and a JSON body
// parser that hands the route an empty body as no arguments and a bad one as a marker, so the route answers in its
// own words instead of Fastify's.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyReply } from "fastify";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ErrorRepliesOptions {
  // Plain text, or JSON as { error }; text unless set.
  format?: "text" | "json";
  // What an unknown path says; "not found" unless set.
  not_found_text?: string;
  // Whether unknown paths are answered here too; on unless set, off for an app whose web folder answers them.
  not_found?: boolean;
  // Where a failure of the server's own is logged; the console unless set.
  log_failure?: (message: string, error: Error) => void;
}

// What the JSON parser hands a route when the body was not JSON.
export const BAD_JSON: unique symbol = Symbol("bad json");

// ── Replies ──────────────────────────────────────────────────────────────────

export function send_text(reply: FastifyReply, status: number, text: string): FastifyReply {
  return reply.code(status).type("text/plain; charset=utf-8").send(text);
}

export function send_error(reply: FastifyReply, status: number, text: string, format: "text" | "json" = "text"): FastifyReply {
  if (format === "json") return reply.code(status).send({ error: text });
  return send_text(reply, status, text);
}

// ── Registration ─────────────────────────────────────────────────────────────

// Errors answer with their own status and message, and unknown paths with 404, all in the one format.
export function register_error_replies(app: FastifyInstance, options: ErrorRepliesOptions = {}): void {
  const { format = "text", not_found_text = "not found", not_found = true } = options;
  const log_failure = options.log_failure ?? ((message, error) => console.error(message, error));

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) log_failure(`${request.method} ${request.url} failed:`, error);
    return send_error(reply, status, error.message, format);
  });
  if (not_found) app.setNotFoundHandler(async (_request, reply) => send_error(reply, 404, not_found_text, format));
}

// An empty body parses as undefined and a body that is not JSON as BAD_JSON, for the route to refuse in its own words.
export function register_lenient_json_body(app: FastifyInstance): void {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, BAD_JSON);
    }
  });
}
