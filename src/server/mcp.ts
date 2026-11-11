// An app's calls as MCP tools on its own server, over the official SDK's streamable HTTP, so an AI client can read and
// change the app's data with the same sign-in as every other program.

// ── Imports ──────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";
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
  // Runs one call with its arguments in order, for the request the call came in.
  call: (method: string, args: unknown[], request: FastifyRequest) => unknown;
}

// A REST route offered as a tool.
export interface RouteToolSpec extends MethodSpec {
  // The route the tool runs, such as "GET /api/hosts/:name"; each :name in the path takes the argument of that name,
  // and the rest go in the query of a GET or DELETE and in the JSON body of anything else.
  route: string;
}

// The request each tool call arrives in, so the call can act as whoever sent it.
const current_request = new AsyncLocalStorage<FastifyRequest>();

// Whether the request came with a read-only token of server/account_sign_in, which may run only the tools that read.
function is_read_only_token(request: FastifyRequest): boolean {
  return (request as { viewer?: { read_only?: boolean } | null }).viewer?.read_only === true;
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
        const request = current_request.getStore()!;
        if (!config.annotations.readOnlyHint && is_read_only_token(request)) throw new Error("This token can only read.");
        const result = await options.call(method, positional_args(spec, named ?? {}), request);
        return { content: [{ type: "text" as const, text: as_text(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  }
  return server;
}

// ── Routes as tools ──────────────────────────────────────────────────────────

// Headers about the MCP request's own body and stream rather than about who sent it.
const transport_headers = new Set([
  "content-length", "content-type", "transfer-encoding", "connection", "accept", "accept-encoding",
  "mcp-session-id", "mcp-protocol-version", "last-event-id",
]);

// A query value as text: strings as they are, anything else as JSON.
function query_value(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

// The words a refusal gives, from its { error } or { message } or its plain text.
function refusal_of(answer: unknown, status: number): string {
  if (typeof answer === "object" && answer !== null) {
    const { error, message } = answer as { error?: unknown; message?: unknown };
    if (typeof error === "string") return error;
    if (typeof message === "string") return message;
  }
  return typeof answer === "string" && answer !== "" ? answer : `The server answered ${status}.`;
}

// A REST app's routes as tools: each runs its route inside the app as the caller, with the caller's own headers and
// address, so it is signed in and checked exactly as the page's request would be; a GET only reads.
export function route_tools(app: FastifyInstance, routes: Record<string, RouteToolSpec>): Pick<McpRouteOptions, "api" | "is_read_only" | "call"> {
  return {
    api: routes,
    is_read_only: (method) => routes[method]!.route.startsWith("GET "),
    call: async (method, args, request) => {
      const spec = routes[method]!;
      const [verb, template] = spec.route.split(" ") as [string, string];
      const rest = new Map(spec.params.map((param, index) => [param.name, args[index]]));
      const path = template.replace(/:(\w+)/g, (_match, name: string) => {
        const value = rest.get(name);
        rest.delete(name);
        return encodeURIComponent(query_value(value));
      });
      const given = [...rest].filter(([, value]) => value !== undefined);
      const in_query = verb === "GET" || verb === "DELETE";
      const query = in_query ? new URLSearchParams(given.map(([name, value]): [string, string] => [name, query_value(value)])).toString() : "";
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !transport_headers.has(name)));
      const answer = await app.inject({
        method: verb as "GET",
        url: query === "" ? path : `${path}?${query}`,
        headers,
        remoteAddress: request.ip,
        ...(!in_query && given.length > 0 ? { payload: Object.fromEntries(given) } : {}),
      });
      const is_json = String(answer.headers["content-type"] ?? "").includes("json") && answer.body !== "";
      const body: unknown = is_json ? JSON.parse(answer.body) : answer.body;
      if (answer.statusCode >= 400) throw new Error(refusal_of(body, answer.statusCode));
      return body === "" ? undefined : body;
    },
  };
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
      const response = await current_request.run(request, () => handler.fetch(to_web_request(request, request.body as string | undefined, aborted.signal)));
      return send_web_response(reply, response);
    });
  });
}
