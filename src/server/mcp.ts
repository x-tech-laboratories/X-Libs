// An app's calls as MCP tools on its own server, over the official SDK's streamable HTTP, so an AI client can read and
// change the app's data with the same sign-in as every other program.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { input_schema, positional_args, type MethodSpec } from "../api_spec.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface McpRouteOptions {
  // The server's name and version as the client sees them.
  name: string;
  version: string;
  // What the client's model reads first: what the app holds and how its values are written.
  instructions?: string;
  // Where the endpoint answers, under the plugin's prefix; "/mcp" unless set.
  path?: string;
  // Every call offered as a tool, by name.
  api: Record<string, MethodSpec>;
  // Marks a tool that only reads, so a client may run it without asking.
  is_read_only: (method: string) => boolean;
  // Runs one call with its arguments in order.
  call: (method: string, args: unknown[]) => unknown;
}

// ── Tools ────────────────────────────────────────────────────────────────────

// A result as the text a model reads; a call that returns nothing says so.
function as_text(result: unknown): string {
  if (result === undefined) return "done";
  return typeof result === "string" ? result : JSON.stringify(result);
}

export function create_mcp_server(options: McpRouteOptions): McpServer {
  const server = new McpServer({ name: options.name, version: options.version }, options.instructions ? { instructions: options.instructions } : {});
  for (const [method, spec] of Object.entries(options.api)) {
    const config = {
      description: spec.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(input_schema(spec)),
      annotations: { readOnlyHint: options.is_read_only(method) },
    };
    server.registerTool(method, config, async (named) => {
      try {
        const result = await options.call(method, positional_args(spec, named ?? {}));
        return { content: [{ type: "text" as const, text: as_text(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  }
  return server;
}

// ── Route ────────────────────────────────────────────────────────────────────

function to_web_request(request: FastifyRequest, body: string | undefined, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const url = new URL(request.url, `${request.protocol}://${request.host}`);
  return new Request(url, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : body, signal });
}

async function send_web_response(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  void reply.code(response.status);
  response.headers.forEach((value, name) => void reply.header(name, value));
  return reply.send(response.body ? Readable.fromWeb(response.body as NodeReadableStream) : null);
}

// Answers MCP at the path given; the body reaches the SDK as sent, so it parses and refuses requests in MCP's own terms.
export async function register_mcp_route(app: FastifyInstance, options: McpRouteOptions): Promise<void> {
  const handler = createMcpHandler(() => create_mcp_server(options));
  app.addHook("onClose", async () => handler.close());

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => done(null, body));
    scope.all(options.path ?? "/mcp", async (request, reply) => {
      const aborted = new AbortController();
      reply.raw.on("close", () => aborted.abort());
      const response = await handler.fetch(to_web_request(request, request.body as string | undefined, aborted.signal));
      return send_web_response(reply, response);
    });
  });
}
