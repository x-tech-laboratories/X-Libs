import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { MethodSpec } from "../../src/api_spec.ts";
import { register_mcp_route } from "../../src/server/mcp.ts";

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
async function rpc(method: string, params: unknown = {}): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const reply = await app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": protocol_version },
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
