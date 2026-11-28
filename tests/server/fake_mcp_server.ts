// A small MCP server for the client's tests, on the official SDK: over streamable HTTP on a random local port, with an
// optional bearer token, or over stdio when this file is run as a program. Its tools read a note (read-only), add a
// note, name the variables it was started with, wait for ever, fail and answer in many parts. Run with "exit" it exits
// at once; with "hang" it never answers.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

export function fake_mcp_server(): McpServer {
  const server = new McpServer({ name: "fake-notes", version: "1.0.0" }, { instructions: "Notes are kept by room; read one by its id." });
  const object = (properties: Record<string, unknown>, required: string[] = []) => fromJsonSchema({ type: "object", properties, required, additionalProperties: false } as never);
  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
  server.registerTool(
    "read_note",
    { description: `Reads a note by its id. ${"Long words. ".repeat(200)}`, inputSchema: object({ id: { type: "string" } }, ["id"]), annotations: { readOnlyHint: true } },
    async (args) => text(`Note ${String((args as Record<string, unknown>).id)}: lay tiles from the middle.`),
  );
  server.registerTool("add_note", { description: "Adds a note.", inputSchema: object({ text: { type: "string" } }, ["text"]) }, async (args) => text(`Added “${String((args as Record<string, unknown>).text)}”.`));
  server.registerTool("env_names", { title: "Variables", inputSchema: object({}), annotations: { readOnlyHint: true } }, async () => text(Object.keys(process.env).sort().join(",")));
  server.registerTool("wait", { description: "Never answers.", inputSchema: object({}), annotations: { readOnlyHint: true } }, () => new Promise(() => undefined));
  server.registerTool("fail", { description: "Always fails.", inputSchema: object({}), annotations: { readOnlyHint: true } }, async () => ({ ...text("It broke."), isError: true }));
  return server;
}

export interface FakeMcpHttp {
  address: string;
  // The Authorization header of each request.
  authorizations: string[];
  close: () => Promise<void>;
}

async function read_body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// The fake server over streamable HTTP at http://127.0.0.1:<port>/mcp, refusing any request without the token when one is given.
export async function start_fake_mcp_http(token = ""): Promise<FakeMcpHttp> {
  const handler = createMcpHandler(() => fake_mcp_server());
  const authorizations: string[] = [];
  const server: Server = createServer(async (request, response) => {
    authorizations.push(String(request.headers.authorization ?? ""));
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await read_body(request);
    const aborted = new AbortController();
    response.on("close", () => aborted.abort());
    const answer = await handler.fetch(new Request(`http://127.0.0.1${request.url}`, { method: request.method, headers, body, signal: aborted.signal }));
    response.writeHead(answer.status, Object.fromEntries(answer.headers.entries()));
    if (!answer.body) return void response.end();
    const reader = answer.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        response.write(value);
      }
    } catch {
      // The client went away.
    }
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    address: `http://127.0.0.1:${port}/mcp`,
    authorizations,
    close: async () => {
      server.closeAllConnections();
      await handler.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// Run as a program, the fake server over stdio, or one that exits or hangs as asked.
if (import.meta.main) {
  const mode = process.argv[2] ?? "serve";
  if (mode === "exit") {
    process.stderr.write("Missing its configuration file.\n");
    process.exit(3);
  } else if (mode === "hang") setInterval(() => undefined, 60_000);
  else serveStdio(() => fake_mcp_server());
}
