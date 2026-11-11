import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { MethodSpec } from "../../src/api_spec.ts";
import { register_mcp_route, route_tools, type RouteToolSpec } from "../../src/server/mcp.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

const api: Record<string, MethodSpec> = {
  list_notes: { description: "Lists the notes.", params: [] },
  add_note: { description: "Adds a note.", params: [{ name: "text", schema: { type: "string", minLength: 1 } }, { name: "pinned", schema: { type: "boolean" }, optional: true }] },
};

// The protocol version the stateless fallback serves, which every MCP client still speaks.
const protocol_version = "2025-06-18";

async function build(notes: string[]): Promise<FastifyInstance> {
  const server = fastify();
  await server.register(
    async (scope) => {
      await register_mcp_route(scope, {
        name: "notes",
        version: "1.0.0",
        instructions: "Notes are plain text.",
        api,
        is_read_only: (method) => method.startsWith("list_"),
        call: (method, args) => {
          if (method === "list_notes") return notes;
          if (args[0] === "boom") throw new Error("the notebook is full");
          notes.push(args[0] as string);
          return undefined;
        },
      });
    },
    { prefix: "/api" },
  );
  return server;
}

// Sends one JSON-RPC request and reads the answer out of the event stream or the JSON body.
async function rpc(method: string, params: unknown = {}, token = "reader"): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const reply = await app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": protocol_version, authorization: `Bearer ${token}` },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(reply.statusCode).toBe(200);
  const data = reply.headers["content-type"]?.includes("text/event-stream") ? /^data: (.+)$/m.exec(reply.body)![1]! : reply.body;
  return JSON.parse(data) as { result?: Record<string, unknown>; error?: unknown };
}

describe("mcp route", () => {
  it("introduces the app and lists every call as a tool, marking the ones that only read", async () => {
    app = await build([]);

    const hello = await rpc("initialize", { protocolVersion: protocol_version, capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(hello.result).toMatchObject({ serverInfo: { name: "notes", version: "1.0.0" }, instructions: "Notes are plain text." });

    const listed = await rpc("tools/list");
    const tools = listed.result!.tools as { name: string; annotations: { readOnlyHint: boolean }; inputSchema: { required: string[] } }[];
    expect(tools.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([["list_notes", true], ["add_note", false]]);
    expect(tools[1]!.inputSchema.required).toEqual(["text"]);
  });

  it("runs a tool with its named arguments in order and answers in JSON text", async () => {
    const notes = ["milk"];
    app = await build(notes);

    const added = await rpc("tools/call", { name: "add_note", arguments: { text: "eggs" } });
    expect(added.result).toEqual({ content: [{ type: "text", text: "done" }] });

    const listed = await rpc("tools/call", { name: "list_notes", arguments: {} });
    expect(listed.result).toEqual({ content: [{ type: "text", text: '["milk","eggs"]' }] });
  });

  it("answers bad arguments and a failing call as tool errors in plain words", async () => {
    app = await build([]);

    const refused = await rpc("tools/call", { name: "add_note", arguments: { text: "" } });
    expect(refused.result).toMatchObject({ isError: true });

    const failed = await rpc("tools/call", { name: "add_note", arguments: { text: "boom" } });
    expect(failed.result).toEqual({ isError: true, content: [{ type: "text", text: "the notebook is full" }] });
  });
});

const routes: Record<string, RouteToolSpec> = {
  get_host: { route: "GET /api/hosts/:name", description: "Shows one host.", params: [{ name: "name", schema: { type: "string" } }, { name: "days", schema: { type: "number" }, optional: true }] },
  restart_host: { route: "POST /api/hosts/:name/restart", description: "Restarts a host.", params: [{ name: "name", schema: { type: "string" } }, { name: "reason", schema: { type: "string" }, optional: true }] },
};

// A server whose routes need a bearer token, and where only the "admin" token may restart a host.
async function build_rest(restarts: unknown[]): Promise<FastifyInstance> {
  const server = fastify();
  server.addHook("onRequest", async (request, reply) => {
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== "reader" && token !== "admin") return reply.code(401).send({ error: "Sign in first." });
    if (request.method === "POST" && request.url !== "/api/mcp" && token !== "admin") return reply.code(403).send({ error: "This needs the admin role." });
  });
  server.get<{ Params: { name: string }; Querystring: { days?: string } }>("/api/hosts/:name", async (request) => ({ name: request.params.name, days: request.query.days ?? null, ip: request.ip }));
  server.post<{ Params: { name: string }; Body: unknown }>("/api/hosts/:name/restart", async (request, reply) => {
    restarts.push([request.params.name, request.body ?? null]);
    return reply.code(204).send();
  });
  await server.register(async (scope) => register_mcp_route(scope, { name: "hosts", version: "1.0.0", ...route_tools(server, routes) }), { prefix: "/api" });
  return server;
}

describe("route tools", () => {
  it("marks a GET as only reading", async () => {
    app = await build_rest([]);

    const listed = await rpc("tools/list");
    const tools = listed.result!.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([["get_host", true], ["restart_host", false]]);
  });

  it("fills the path from its arguments and puts the rest in the query of a GET and the body of a POST", async () => {
    const restarts: unknown[] = [];
    app = await build_rest(restarts);

    const shown = await rpc("tools/call", { name: "get_host", arguments: { name: "odin box", days: 7 } });
    expect(JSON.parse((shown.result!.content as { text: string }[])[0]!.text)).toEqual({ name: "odin box", days: "7", ip: "127.0.0.1" });

    const restarted = await rpc("tools/call", { name: "restart_host", arguments: { name: "odin", reason: "kernel" } }, "admin");
    expect(restarted.result).toEqual({ content: [{ type: "text", text: "done" }] });
    await rpc("tools/call", { name: "restart_host", arguments: { name: "loki" } }, "admin");
    expect(restarts).toEqual([["odin", { reason: "kernel" }], ["loki", null]]);
  });

  it("runs each route as the caller, so the app's own refusal comes back as the tool's error", async () => {
    const restarts: unknown[] = [];
    app = await build_rest(restarts);

    const refused = await rpc("tools/call", { name: "restart_host", arguments: { name: "odin" } }, "reader");
    expect(refused.result).toEqual({ isError: true, content: [{ type: "text", text: "This needs the admin role." }] });
    expect(restarts).toEqual([]);
  });
});
