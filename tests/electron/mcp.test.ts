import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MethodSpec } from "../../src/api_spec.ts";
import { create_local_mcp, type LocalMcp } from "../../src/electron/mcp.ts";
import { local_mcp_add_command, local_mcp_client_config, read_local_mcp_settings } from "../../src/local_mcp_protocol.ts";

const api: Record<string, MethodSpec> = {
  list_notes: { description: "Lists the notes.", params: [] },
  add_note: { description: "Adds a note.", params: [{ name: "text", schema: { type: "string", minLength: 1 } }] },
  clear_notes: { description: "Removes every note.", params: [], destructive: true },
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
function rpc(url: string, method: string, params: unknown, host?: string, bearer?: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const sent = request(
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": protocol_version, ...(host ? { host } : {}), ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
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

    const listed = await rpc(status.url, "tools/list", {});
    const tools = (listed.body!.result as { tools: { name: string; annotations: Record<string, boolean> }[] }).tools;
    expect(tools.find((tool) => tool.name === "clear_notes")!.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });

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
    expect(local.methods.get_local_mcp_settings()).toEqual({ enabled: false, port: 0, require_token: false });
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
    expect(read_local_mcp_settings(null, 3920)).toEqual({ enabled: false, port: 3920, require_token: false });
    expect(read_local_mcp_settings({ enabled: true, port: 70000 }, 3920)).toEqual({ enabled: true, port: 3920, require_token: false });
    expect(read_local_mcp_settings({ enabled: "yes", port: 4000, require_token: true }, 3920)).toEqual({ enabled: false, port: 4000, require_token: true });
  });
});

describe("local mcp with a token", () => {
  it("refuses a call without the token, and takes one with it", async () => {
    await local.methods.set_local_mcp_settings({ enabled: true, port: 0, require_token: true });
    const status = await local.methods.get_local_mcp_status();
    expect(status.state).toBe("running");
    expect(status.token_file).toBe(join(folder, "mcp-token"));
    const token = readFileSync(status.token_file!, "utf8").trim();
    expect(status.token).toBe(token);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(statSync(status.token_file!).mode & 0o777).toBe(0o600);

    expect((await rpc(status.url, "tools/list", {})).status).toBe(401);
    expect((await rpc(status.url, "tools/list", {}, undefined, "wrong")).status).toBe(401);
    expect((await rpc(status.url, "tools/list", {}, undefined, `${token}x`)).status).toBe(401);
    expect((await rpc(status.url, "tools/list", {}, "evil.example", token)).status).toBe(403);
    const added = await rpc(status.url, "tools/call", { name: "add_note", arguments: { text: "eggs" } }, undefined, token);
    expect(added.body).toMatchObject({ result: { content: [{ type: "text", text: "done" }] } });
    expect(notes).toEqual(["milk", "eggs"]);
  });

  it("keeps the token across restarts, and makes a new one after it was turned off", async () => {
    await local.methods.set_local_mcp_settings({ enabled: true, port: 0, require_token: true });
    const first = (await local.methods.get_local_mcp_status()).token;
    await local.stop();
    await local.start();
    expect((await local.methods.get_local_mcp_status()).token).toBe(first);

    await local.methods.set_local_mcp_settings({ enabled: true, port: 0, require_token: false });
    const open = await local.methods.get_local_mcp_status();
    expect(open.token).toBeUndefined();
    expect(existsSync(join(folder, "mcp-token"))).toBe(false);
    expect((await rpc(open.url, "tools/list", {})).status).toBe(200);

    await local.methods.set_local_mcp_settings({ enabled: true, port: 0, require_token: true });
    const second = (await local.methods.get_local_mcp_status()).token;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});

describe("client config", () => {
  const running = { state: "running" as const, url: "http://127.0.0.1:3921/mcp", error: "" };

  it("names the endpoint, with the bearer header while a token is required", () => {
    expect(local_mcp_client_config("x-notes", running)).toEqual({ mcpServers: { "x-notes": { type: "http", url: running.url } } });
    expect(local_mcp_client_config("x-notes", { ...running, token: "abc", token_file: "/run/notes/key" })).toEqual({
      mcpServers: { "x-notes": { type: "http", url: running.url, headers: { Authorization: "Bearer abc" } } },
    });
    expect(local_mcp_client_config("x-notes", { state: "off", url: "", error: "" })).toBeNull();
  });

  it("gives the command that adds it, reading the token from its file", () => {
    expect(local_mcp_add_command("x-notes", running)).toBe("claude mcp add --transport http x-notes http://127.0.0.1:3921/mcp");
    expect(local_mcp_add_command("x-notes", { ...running, token: "abc", token_file: "/srv/o'neil/key" })).toBe(
      `claude mcp add --transport http --header "Authorization: Bearer $(cat '/srv/o'\\''neil/key')" x-notes http://127.0.0.1:3921/mcp`,
    );
    expect(local_mcp_add_command("x-notes", { state: "failed", url: "", error: "taken" })).toBeNull();
  });
});
