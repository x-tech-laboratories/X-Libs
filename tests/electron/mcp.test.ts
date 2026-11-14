import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MethodSpec } from "../../src/api_spec.ts";
import { create_local_mcp, type LocalMcp } from "../../src/electron/mcp.ts";
import { read_local_mcp_settings } from "../../src/local_mcp_protocol.ts";

const api: Record<string, MethodSpec> = {
  list_notes: { description: "Lists the notes.", params: [] },
  add_note: { description: "Adds a note.", params: [{ name: "text", schema: { type: "string", minLength: 1 } }] },
};

const protocol_version = "2025-06-18";

let folder: string;
let local: LocalMcp;
let notes: string[];
let changes: number;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "local-mcp-"));
  notes = ["milk"];
  changes = 0;
  local = create_local_mcp({
    name: "notes",
    version: "1.0.0",
    api,
    is_read_only: (method) => method.startsWith("list_"),
    settings_file: join(folder, "mcp.json"),
    default_port: 0,
    call: (method, args) => {
      if (method === "list_notes") return notes;
      notes.push(args[0] as string);
      changes += 1;
      return undefined;
    },
  });
});

afterEach(async () => {
  await local.stop();
  rmSync(folder, { recursive: true, force: true });
});

// Sends one JSON-RPC request with the Host header given and answers the status and the parsed reply.
function rpc(url: string, method: string, params: unknown, host?: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const sent = request(
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": protocol_version, ...(host ? { host } : {}) },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => (text += chunk.toString()));
        response.on("end", () => {
          const data = /^data: (.+)$/m.exec(text)?.[1] ?? text;
          resolve({ status: response.statusCode ?? 0, body: response.statusCode === 200 ? (JSON.parse(data) as Record<string, unknown>) : null });
        });
      },
    );
    sent.on("error", reject);
    sent.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  });
}

describe("local mcp", () => {
  it("stays off until turned on, then serves the calls as tools on 127.0.0.1", async () => {
    await local.start();
    expect(await local.methods.get_local_mcp_status()).toEqual({ state: "off", url: "", error: "" });

    await local.methods.set_local_mcp_settings({ enabled: true, port: 0 });
    const status = await local.methods.get_local_mcp_status();
    expect(status.state).toBe("running");
    expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const added = await rpc(status.url, "tools/call", { name: "add_note", arguments: { text: "eggs" } });
    expect(added.body).toMatchObject({ result: { content: [{ type: "text", text: "done" }] } });
    expect(notes).toEqual(["milk", "eggs"]);
    expect(changes).toBe(1);
  });

  it("refuses a request that names another host, as a page pointing its own domain here would", async () => {
    await local.methods.set_local_mcp_settings({ enabled: true, port: 0 });
    const { url } = await local.methods.get_local_mcp_status();

    expect((await rpc(url, "tools/list", {}, "evil.example")).status).toBe(403);
    expect((await rpc(url, "tools/list", {}, `localhost:${new URL(url).port}`)).status).toBe(200);
  });

  it("keeps its settings in the file and stops when turned off", async () => {
    await local.methods.set_local_mcp_settings({ enabled: true, port: 0 });
    const { url } = await local.methods.get_local_mcp_status();

    await local.methods.set_local_mcp_settings({ enabled: false, port: 0 });
    expect(local.methods.get_local_mcp_settings()).toEqual({ enabled: false, port: 0 });
    expect((await local.methods.get_local_mcp_status()).state).toBe("off");
    await expect(rpc(url, "tools/list", {})).rejects.toThrow();
  });

  it("says why it failed when the port is taken", async () => {
    await local.methods.set_local_mcp_settings({ enabled: true, port: 0 });
    const port = Number(new URL((await local.methods.get_local_mcp_status()).url).port);
    const other = create_local_mcp({ name: "other", version: "1.0.0", api, is_read_only: () => true, settings_file: join(folder, "other.json"), default_port: port, call: () => [] });

    await other.methods.set_local_mcp_settings({ enabled: true, port });
    const status = await other.methods.get_local_mcp_status();
    expect(status.state).toBe("failed");
    expect(status.error).toMatch(/EADDRINUSE/);
    await other.stop();
  });
});

describe("read_local_mcp_settings", () => {
  it("fills in what is missing or out of range", () => {
    expect(read_local_mcp_settings(null, 3920)).toEqual({ enabled: false, port: 3920 });
    expect(read_local_mcp_settings({ enabled: true, port: 70000 }, 3920)).toEqual({ enabled: true, port: 3920 });
    expect(read_local_mcp_settings({ enabled: "yes", port: 4000 }, 3920)).toEqual({ enabled: false, port: 4000 });
  });
});
