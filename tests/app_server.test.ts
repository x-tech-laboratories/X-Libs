import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { build_server, call_args, run_server, type RunningServer } from "../src/app/server.ts";
import { AccountStore } from "../src/server/account_store.ts";
import { EventStream } from "../src/server/events.ts";
import { hash_password } from "../src/server/passwords.ts";
import { file_sync_storage } from "../src/sync_file_storage.ts";
import { create_sync_peer } from "../src/sync_peer.ts";
import { sample_app } from "./app/sample_app.ts";

// ============================================================================
// Helpers
// ============================================================================

let server: FastifyInstance | null = null;
let running: RunningServer | null = null;
let cookie = "";
let accounts: AccountStore;

const backup_methods = {
  list_backups: vi.fn(async () => []),
  create_backup: vi.fn(),
  restore_backup: vi.fn(),
  remove_backup: vi.fn(),
  get_backup_schedule: vi.fn(() => ({ automatic: true, to_keep: 14 })),
  set_backup_schedule: vi.fn(),
};

// A made-up password for the throwaway admin these tests sign in as.
const test_password = "sample test password";

afterEach(async () => {
  await server?.close();
  await running?.stop();
  server = null;
  running = null;
});

async function start(web_folder = "/nonexistent"): Promise<FastifyInstance> {
  const database = new DatabaseSync(":memory:");
  sample_app.open_store(database);
  accounts = new AccountStore({ database: new DatabaseSync(":memory:"), app_name: "X-Sample", declared: new Map([["admin", hash_password(test_password)]]) });
  const sync = create_sync_peer({
    app: "x-sample",
    engine: sample_app.sync_engine,
    database: () => database,
    storage: file_sync_storage({ file: join(mkdtempSync(join(tmpdir(), "x-libs-app-peers-")), "sync-peers.json"), back_up_before_replace: vi.fn() }),
    device_name: "X-Sample test server",
    addresses: () => ["https://notes.example.org/api/"],
  });
  server = await build_server(sample_app, { database: () => database, accounts, web_folder, sync, changes: new EventStream(), backup_methods });
  const signed_in = await server.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password } });
  cookie = signed_in.cookies.map((each) => `${each.name}=${each.value}`).join("; ");
  return server;
}

// A port nothing listens on, since the server's config takes no port 0.
async function free_port(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

// A call from the signed-in page.
function call(method: string, payload: unknown) {
  return server!.inject({ method: "POST", url: `/api/call/${method}`, payload: payload as object, headers: { cookie } });
}

// Sends one MCP request as a signed-in client speaking the 2025 protocol would, and gives back its result.
async function mcp(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const reply = await server!.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { cookie, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = /^data: (.+)$/m.exec(reply.body)?.[1] ?? reply.body;
  return (JSON.parse(data) as { result: Record<string, unknown> }).result;
}

// ============================================================================
// Server
// ============================================================================

describe("app server", () => {
  it("serves the built page beside the API", async () => {
    const folder = mkdtempSync(join(tmpdir(), "x-libs-app-web-"));
    writeFileSync(join(folder, "index.html"), "<title>X-Sample</title>");
    await start(folder);

    expect((await server!.inject({ method: "GET", url: "/" })).body).toContain("X-Sample");
    expect((await server!.inject({ method: "GET", url: "/api/missing", headers: { cookie } })).statusCode).toBe(404);
  });

  it("answers the page's calls with JSON arguments, a bare string answer as JSON too", async () => {
    await start();

    const added = await call("add_note", ["Groceries"]);

    expect(added.headers["content-type"]).toContain("application/json");
    expect((await call("list_notes", [])).json()).toEqual([{ id: added.json(), title: "Groceries" }]);
    expect((await call("set_setting", ["currency", "JMD"])).statusCode).toBe(204);
  });

  it("takes a call's arguments by name as a JSON object, and refuses anything else", async () => {
    await start();

    expect((await call("set_setting", { value: "JMD", key: "currency" })).statusCode).toBe(204);

    expect((await call("get_settings", [])).json()).toMatchObject({ currency: "JMD" });
    expect((await call("rename_note", { id: "note-1" })).statusCode).toBe(400);
    expect((await call("drop_everything", [])).statusCode).toBeGreaterThanOrEqual(400);
    expect(() => call_args(sample_app, "list_notes", "5")).toThrow("JSON list or object");
  });

  it("lets only an admin reach the server's backups and its own pairing", async () => {
    await start();
    accounts.create_user({ name: "reader", role: "user", access: null, password: "another made-up password" });
    const reader = await server!.inject({ method: "POST", url: "/api/login", payload: { name: "reader", password: "another made-up password" } });
    const reader_cookie = reader.cookies.map((each) => `${each.name}=${each.value}`).join("; ");

    const listed = await server!.inject({ method: "POST", url: "/api/backups/list_backups", payload: [], headers: { cookie } });
    const refused = await server!.inject({ method: "POST", url: "/api/backups/list_backups", payload: [], headers: { cookie: reader_cookie } });
    const pairing = await server!.inject({ method: "POST", url: "/api/device/create_pairing_code", payload: [], headers: { cookie } });

    expect(listed.json()).toEqual([]);
    expect(refused.statusCode).toBe(403);
    expect(JSON.parse(pairing.body)).toHaveProperty("code");
    expect((await server!.inject({ method: "POST", url: "/api/call/list_notes", payload: [], headers: { cookie: reader_cookie } })).statusCode).toBe(200);
    expect((await server!.inject({ method: "POST", url: "/api/backups/list_backups", payload: { not: "a list" }, headers: { cookie } })).statusCode).toBe(400);
  });

  it("turns away a page that has not signed in, but not another device's sealed sync", async () => {
    await start();

    expect((await server!.inject({ method: "POST", url: "/api/call/list_notes", payload: [] })).statusCode).toBe(401);
    expect((await server!.inject({ method: "POST", url: "/api/device/get_sync_status", payload: [] })).statusCode).toBe(401);
    const sealed = await server!.inject({ method: "POST", url: "/api/sync/peer", headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("not sealed") });
    expect(sealed.statusCode).not.toBe(401);
  });

  it("names the session cookie after the app", async () => {
    await start();
    const signed_in = await server!.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password } });
    expect(signed_in.cookies.map((each) => each.name)).toContain("x_sample_session");
  });

  it("describes every call in an OpenAPI document and serves them as MCP tools", async () => {
    await start();
    const document = (await server!.inject({ method: "GET", url: "/api/openapi.json", headers: { cookie } })).json() as { info: { title: string; version: string }; paths: Record<string, unknown> };
    expect(document.info).toMatchObject({ title: "X-Sample", version: "1.2.3" });
    expect(Object.keys(document.paths)).toContain("/api/call/add_note");

    await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tests", version: "1" } });
    const { tools } = (await mcp("tools/list")) as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    expect(tools.find((tool) => tool.name === "list_notes")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "add_note")?.annotations?.readOnlyHint).toBe(false);

    await mcp("tools/call", { name: "add_note", arguments: { title: "From MCP" } });
    expect((await call("list_notes", [])).json()).toEqual([expect.objectContaining({ title: "From MCP" })]);
  });
});

// ============================================================================
// Running
// ============================================================================

describe("run_server", { timeout: 30_000 }, () => {
  it("starts from the config the environment names, with accounts from the file beside it", async () => {
    const folder = mkdtempSync(join(tmpdir(), "x-libs-app-run-"));
    const config = join(folder, "config.json");
    writeFileSync(config, JSON.stringify({ database: join(folder, "data", "sample.db"), backups_folder: join(folder, "backups"), sync_address: "https://notes.example.org/api/" }));
    const password_file = join(folder, "password.hash");
    writeFileSync(password_file, `admin:${hash_password(test_password)}\n`);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    running = await run_server(sample_app, {
      web_folder: pathToFileURL(join(folder, "web")),
      argv: ["--port", String(await free_port()), "--host", "127.0.0.1"],
      env: { X_SAMPLE_CONFIG: config, X_SAMPLE_PASSWORD_HASH_FILE: password_file },
    });
    const signed_in = await running.server.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password } });

    expect(running.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(signed_in.statusCode).toBeLessThan(300);
  });
});
