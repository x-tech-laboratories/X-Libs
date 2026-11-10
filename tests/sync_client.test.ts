import { DatabaseSync } from "node:sqlite";

import { expect, it } from "vitest";

import { migrate } from "../src/sql.ts";
import { asks_for_code, create_sync_client, type SyncConfig } from "../src/sync_client.ts";
import { create_sync_engine } from "../src/sync_engine.ts";

const engine = create_sync_engine({ tables: [{ name: "items", key_columns: ["id"] }] });

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

// A device whose server answers sign-ins, replaces and sign-outs, keeping what each request carried.
function device() {
  const database = new DatabaseSync(":memory:");
  migrate(database, ["CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL)"]);
  engine.install(database);
  const requests: { path: string; body: Record<string, unknown>; authorization: string }[] = [];
  let saved: SyncConfig | null = null;
  const fetch_function = (async (input: URL, init?: RequestInit) => {
    const path = input.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ path, body, authorization: String((init?.headers as Record<string, string>)?.authorization ?? "") });
    if (path === "/api/login") return body.code === "123456" ? json({ token: "xt_device", id: 1 }, 201) : json({ error: "Enter the code from your authenticator app.", code_needed: true }, 401);
    if (path === "/api/sync/replace") return json({ generation: "g1", cursor: 0 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const client = create_sync_client({
    engine, database: () => database, device_name: "X-Test on laptop", fetch: fetch_function, full_sync_ms: 1e9,
    storage: {
      read_config: () => saved,
      write_config: (config) => { saved = config; },
      remove_config: () => { saved = null; },
      back_up_before_download: () => {},
    },
  });
  return { client, requests, saved: () => saved };
}

it("signs a device in for a token of its own, and gives the token back when it stops syncing", async () => {
  const { client, requests, saved } = device();

  const refused = await client.connect("https://sync.example.org", { name: "Ada", password: "secret" }, "upload").catch((error: unknown) => error);
  const status = await client.connect("https://sync.example.org", { name: "Ada", password: "secret", code: "123456" }, "upload");
  client.stop();

  expect(asks_for_code(refused)).toBe(true);
  expect(requests[1]!.body).toEqual({ name: "Ada", password: "secret", code: "123456", device: "X-Test on laptop" });
  expect(saved()).toEqual({ server_url: "https://sync.example.org/", token: "xt_device", user: "ada" });
  expect(status).toMatchObject({ state: "idle", user: "ada" });
  expect(requests.find((request) => request.path === "/api/sync/replace")!.authorization).toBe("Bearer xt_device");

  client.disconnect();

  expect(requests.at(-1)).toMatchObject({ path: "/api/logout", authorization: "Bearer xt_device" });
  expect(saved()).toBeNull();
});
