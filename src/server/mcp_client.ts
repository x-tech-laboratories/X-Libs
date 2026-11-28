// A client of the MCP servers a user adds, on the official SDK's client: streamable HTTP with an optional bearer token,
// or a local command started without a shell, with only the SDK's safe variables (HOME, LOGNAME, PATH, SHELL, TERM,
// USER) and those the user names. One connection per server is kept while used and closed when idle; a server that
// exits, hangs or answers badly gives a plain error and never takes the app down.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import type { JsonSchema } from "../api_spec.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// A server as the user added it; an app's own record with more fields fits.
export interface McpServerTarget {
  id: string;
  // Named in its failures, such as "Notes".
  name: string;
  transport: "http" | "stdio";
  // For http: the address it answers at, and a bearer token, empty for none.
  address?: string;
  token?: string;
  // For stdio: the program started, without a shell, its arguments, and the names of the app's own environment
  // variables passed to it.
  command?: string;
  args?: string[];
  variables?: string[];
}

// A tool as the server listed it; its description is the server's own words.
export interface McpToolRecord {
  name: string;
  description: string;
  // The server marks it read-only; every other tool counts as changing something.
  read_only: boolean;
  input_schema: JsonSchema;
}

// What a server answers when its tools are listed: the tools, and its instructions, empty for none.
export interface McpListing {
  tools: McpToolRecord[];
  instructions: string;
}

export interface McpLimits {
  // Starting or reaching a server and listing its tools.
  connect_ms: number;
  // One tool call, unless its signal stops it first.
  call_ms: number;
  // A connection unused this long is closed, stopping a local server.
  idle_ms: number;
  // The most tools read from one server, and of a description's characters.
  max_tools: number;
  max_description: number;
  // The most of a server's instructions kept.
  max_instructions: number;
  // The most of what a server wrote on stderr kept for a plain error.
  stderr_chars: number;
}

export const default_mcp_limits: McpLimits = {
  connect_ms: 20_000,
  call_ms: 60_000,
  idle_ms: 120_000,
  max_tools: 200,
  max_description: 2000,
  max_instructions: 2000,
  stderr_chars: 600,
};

export interface McpClientOptions {
  // How the app names itself to the servers, such as { name: "X-Notes", version: "1.2.0" }.
  name: string;
  version: string;
  limits?: Partial<McpLimits>;
}

export interface McpClient {
  // The limits in force, which a test may lower.
  limits: McpLimits;
  // The tools the server lists now, with its instructions; throws a plain error when it cannot be reached or does not answer.
  list_tools(server: McpServerTarget): Promise<McpListing>;
  // Runs one tool and answers with its text; throws a plain error when the tool or the server fails, and "Stopped." once the signal aborts.
  call_tool(server: McpServerTarget, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string>;
  // Closes the connection to one server, or to every server, stopping a local one.
  forget(server_id?: string): Promise<void>;
  // How many connections are open.
  open_connections(): number;
}

// ── Results ──────────────────────────────────────────────────────────────────

// A tool's answer as text: its text parts, then what else it gave said in words.
export function result_text(result: CallToolResult): string {
  const parts: string[] = [];
  for (const part of result.content ?? []) {
    if (part.type === "text") parts.push(part.text);
    else if (part.type === "resource" && "text" in part.resource && typeof part.resource.text === "string") parts.push(part.resource.text);
    else if (part.type === "resource_link") parts.push(`[${part.name}: ${part.uri}]`);
    else parts.push(`[${part.type}]`);
  }
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return parts.join("\n") || "(No answer.)";
}

// What the server said of how to use it when it was reached, cut to the limit.
export function instructions_of(said: string | undefined, max = default_mcp_limits.max_instructions): string {
  const text = (said ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// The variables passed to a local server: only those the user named, from the app's own environment; the SDK adds its safe ones.
export function passed_variables(names: string[], from: Record<string, string | undefined> = process.env): Record<string, string> {
  return Object.fromEntries(names.filter((name) => typeof from[name] === "string").map((name) => [name, from[name]!]));
}

// ── Client ───────────────────────────────────────────────────────────────────

interface Connection {
  key: string;
  client: Client;
  closed: boolean;
  idle?: ReturnType<typeof setTimeout>;
  // The last of what a local server wrote on stderr.
  stderr: string;
}

function key_of(server: McpServerTarget): string {
  return JSON.stringify([server.transport, server.address, server.token, server.command, server.args, server.variables]);
}

function where(server: McpServerTarget): string {
  if (server.transport === "stdio") return `the command ${server.command}`;
  try {
    return new URL(server.address ?? "").host;
  } catch {
    return server.address ?? "";
  }
}

function within<Value>(work: Promise<Value>, ms: number, what: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} seconds.`)), ms)));
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

// A client keeping its own connections, one per server id.
export function create_mcp_client(options: McpClientOptions): McpClient {
  const limits: McpLimits = { ...default_mcp_limits, ...options.limits };
  const connections = new Map<string, Connection>();

  // What a server's failure means, in plain words, naming the server and never its token.
  const plain = (server: McpServerTarget, error: unknown, connection?: Connection): Error => {
    const raw = error instanceof Error ? error.message : String(error);
    const said = connection?.stderr.trim() ? ` It wrote: ${connection.stderr.trim().slice(-limits.stderr_chars)}` : "";
    const message = server.token ? raw.split(server.token).join("[hidden]") : raw;
    if (/ENOENT/.test(message)) return new Error(`${server.name} could not be started: ${server.command} was not found.`);
    if (/EACCES/.test(message)) return new Error(`${server.name} could not be started: ${server.command} may not be run.`);
    if (/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN/.test(message)) return new Error(`${server.name} could not be reached at ${where(server)}.`);
    if (/\b401\b|Unauthorized/i.test(message)) return new Error(`${server.name} refused the token.`);
    if (/closed|EPIPE/i.test(message)) return new Error(`${server.name} stopped: it exited or closed its connection.${said}`);
    return new Error(`${server.name} failed: ${message}${said}`);
  };

  const close = async (server_id: string): Promise<void> => {
    const connection = connections.get(server_id);
    if (!connection) return;
    connections.delete(server_id);
    connection.closed = true;
    clearTimeout(connection.idle);
    await connection.client.close().catch(() => undefined);
  };

  const keep_alive = (server_id: string, connection: Connection): void => {
    clearTimeout(connection.idle);
    connection.idle = setTimeout(() => void close(server_id), limits.idle_ms);
    connection.idle.unref?.();
  };

  const connect = async (server: McpServerTarget): Promise<Connection> => {
    const key = key_of(server);
    const existing = connections.get(server.id);
    if (existing && existing.key === key && !existing.closed) return existing;
    if (existing) await close(server.id);
    const client = new Client({ name: options.name, version: options.version });
    const connection: Connection = { key, client, closed: false, stderr: "" };
    let transport: StdioClientTransport | StreamableHTTPClientTransport;
    if (server.transport === "stdio") {
      const stdio = new StdioClientTransport({ command: server.command ?? "", args: server.args ?? [], env: passed_variables(server.variables ?? []), stderr: "pipe" });
      stdio.stderr?.on("data", (chunk: Buffer) => (connection.stderr = (connection.stderr + chunk.toString("utf8")).slice(-limits.stderr_chars)));
      transport = stdio;
    } else {
      const token = server.token;
      transport = new StreamableHTTPClientTransport(new URL(server.address ?? ""), token ? { authProvider: { token: async () => token } } : {});
    }
    // A failing transport ends the connection here, never the process.
    client.onerror = () => undefined;
    client.onclose = () => {
      connection.closed = true;
      if (connections.get(server.id) === connection) connections.delete(server.id);
    };
    try {
      await within(client.connect(transport), limits.connect_ms, server.name);
    } catch (error) {
      connection.closed = true;
      await client.close().catch(() => undefined);
      throw plain(server, error, connection);
    }
    connections.set(server.id, connection);
    keep_alive(server.id, connection);
    return connection;
  };

  const list_tools = async (server: McpServerTarget): Promise<McpListing> => {
    const connection = await connect(server);
    try {
      const tools: McpToolRecord[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10 && tools.length < limits.max_tools; page += 1) {
        const answer = await connection.client.listTools(cursor ? { cursor } : undefined, { timeout: limits.connect_ms });
        for (const tool of answer.tools) {
          const description = String(tool.description ?? tool.title ?? "");
          tools.push({
            name: tool.name,
            description: description.length > limits.max_description ? `${description.slice(0, limits.max_description - 1)}…` : description,
            read_only: tool.annotations?.readOnlyHint === true,
            input_schema: tool.inputSchema && typeof tool.inputSchema === "object" ? (tool.inputSchema as JsonSchema) : { type: "object", properties: {} },
          });
        }
        cursor = answer.nextCursor;
        if (!cursor) break;
      }
      keep_alive(server.id, connection);
      return { tools: tools.slice(0, limits.max_tools), instructions: instructions_of(connection.client.getInstructions(), limits.max_instructions) };
    } catch (error) {
      await close(server.id);
      throw plain(server, error, connection);
    }
  };

  const call_tool = async (server: McpServerTarget, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> => {
    const connection = await connect(server);
    let result: CallToolResult;
    try {
      result = (await connection.client.callTool({ name, arguments: args }, { signal, timeout: limits.call_ms })) as CallToolResult;
    } catch (error) {
      // A call that hung or broke leaves the server in doubt, so the next call starts afresh.
      await close(server.id);
      if (signal.aborted) throw new Error("Stopped.");
      throw plain(server, error, connection);
    }
    keep_alive(server.id, connection);
    const text = result_text(result);
    if (result.isError) throw new Error(text);
    return text;
  };

  const forget = async (server_id?: string): Promise<void> => {
    const ids = server_id === undefined ? [...connections.keys()] : [server_id];
    await Promise.all(ids.map(close));
  };

  return { limits, list_tools, call_tool, forget, open_connections: () => connections.size };
}
