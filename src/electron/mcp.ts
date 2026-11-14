// A desktop app's own MCP endpoint: its calls as tools on 127.0.0.1, for AI clients on the same computer, turned on
// and given a port in Settings and kept in a file beside the app's data.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

import fastify, { type FastifyInstance } from "fastify";

import { read_local_mcp_settings, type LocalMcpMethods, type LocalMcpSettings, type LocalMcpStatus } from "../local_mcp_protocol.ts";
import { register_mcp_route, type McpRouteOptions } from "../server/mcp.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface LocalMcpOptions extends Omit<McpRouteOptions, "path" | "call"> {
  // The JSON file the settings are kept in.
  settings_file: string;
  // The port used until one is set; each app picks its own so several can run at once.
  default_port: number;
  // Runs one call with its arguments in order; a call that changes data should tell the open windows.
  call: (method: string, args: unknown[]) => unknown;
}

export interface LocalMcp {
  methods: LocalMcpMethods;
  // Starts the endpoint if it is turned on.
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const mcp_path = "/mcp";
const local_hostnames = ["localhost", "127.0.0.1", "[::1]"];

// ── Endpoint ─────────────────────────────────────────────────────────────────

// Only local names are let in, so a web page cannot reach the endpoint by pointing a domain of its own at this computer.
function is_local(header: string | undefined, as_url: boolean): boolean {
  if (header === undefined) return as_url;
  const hostname = as_url ? URL.parse(header)?.host : header;
  return local_hostnames.includes((hostname ?? "").replace(/:\d+$/, ""));
}

async function listen(options: LocalMcpOptions, port: number): Promise<FastifyInstance> {
  const app = fastify();
  app.addHook("onRequest", async (request, reply) => {
    if (!is_local(request.headers.host, false) || !is_local(request.headers.origin, true)) return reply.code(403).send("Only this computer may call in.");
  });
  await register_mcp_route(app, { ...options, path: mcp_path, call: (method, args) => options.call(method, args) });
  try {
    await app.listen({ port, host: "127.0.0.1" });
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}

export function create_local_mcp(options: LocalMcpOptions): LocalMcp {
  let app: FastifyInstance | null = null;
  let status: LocalMcpStatus = { state: "off", url: "", error: "" };
  let restarting: Promise<void> = Promise.resolve();

  const read_settings = (): LocalMcpSettings =>
    read_local_mcp_settings(existsSync(options.settings_file) ? JSON.parse(readFileSync(options.settings_file, "utf8")) : null, options.default_port);

  async function close(): Promise<void> {
    const closing = app;
    app = null;
    status = { state: "off", url: "", error: "" };
    await closing?.close();
  }

  async function open(): Promise<void> {
    const settings = read_settings();
    if (!settings.enabled) return;
    try {
      app = await listen(options, settings.port);
      status = { state: "running", url: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}${mcp_path}`, error: "" };
    } catch (error) {
      status = { state: "failed", url: "", error: error instanceof Error ? error.message : String(error) };
    }
  }

  // Each restart waits for the last, so quick changes in Settings never leave two endpoints running.
  const restart = (): Promise<void> => (restarting = restarting.then(async () => {
    await close();
    await open();
  }));

  return {
    methods: {
      get_local_mcp_settings: read_settings,
      set_local_mcp_settings: (settings) => {
        writeFileSync(options.settings_file, JSON.stringify(read_local_mcp_settings(settings, options.default_port), null, 2));
        return restart();
      },
      get_local_mcp_status: async () => {
        await restarting;
        return status;
      },
    },
    start: restart,
    stop: () => (restarting = restarting.then(close)),
  };
}
