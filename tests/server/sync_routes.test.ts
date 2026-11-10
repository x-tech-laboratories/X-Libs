import { DatabaseSync } from "node:sqlite";

import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { register_sync_routes } from "../../src/server/sync_routes.ts";
import type { SqlDatabase } from "../../src/sql.ts";
import { create_sync_client, type SyncConfig } from "../../src/sync_client.ts";
import { create_sync_engine } from "../../src/sync_engine.ts";

const engine = create_sync_engine({ tables: [{ name: "notes", key_columns: ["id"] }] });

function open_database(): SqlDatabase {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, text TEXT NOT NULL)");
  engine.install(database);
  return database;
}

function memory_storage(): { read_config: () => SyncConfig | null; write_config: (config: SyncConfig) => void; remove_config: () => void; back_up_before_download: () => void } {
  let config: SyncConfig | null = null;
  return {
    read_config: () => config,
    write_config: (next) => {
      config = next;
    },
    remove_config: () => {
      config = null;
    },
    back_up_before_download: () => undefined,
  };
}

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

async function start_server(server: SqlDatabase, back_up = vi.fn(), on_change = vi.fn()): Promise<string> {
  app = fastify({ forceCloseConnections: true });
  await app.register(async (api) => register_sync_routes(api, { engine, database: () => server, back_up, on_change }), { prefix: "/api" });
  return app.listen({ port: 0, host: "127.0.0.1" });
}

describe("sync routes", () => {
  it("refuses a malformed exchange and one following replaced data", async () => {
    await start_server(open_database());

    const malformed = await app.inject({ method: "POST", url: "/api/sync/exchange", payload: { changes: "no" } });
    expect(malformed.statusCode).toBe(400);

    const stale = await app.inject({ method: "POST", url: "/api/sync/exchange", payload: { site: "a", generation: "old", cursor: 0, changes: [] } });
    expect(stale.statusCode).toBe(409);
  });

  it("backs up and starts a new generation when a device replaces the data", async () => {
    const server = open_database();
    const back_up = vi.fn();
    const on_change = vi.fn();
    await start_server(server, back_up, on_change);
    const before = engine.read_state(server).generation;

    const reply = await app.inject({ method: "POST", url: "/api/sync/replace", payload: { changes: [] } });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().generation).not.toBe(before);
    expect(back_up).toHaveBeenCalledOnce();
    expect(on_change).toHaveBeenCalledOnce();
  });
});

describe("sync client", () => {
  it("uploads one device's data, downloads it to another and exchanges later edits", async () => {
    const server = open_database();
    const address = await start_server(server);
    const desktop = open_database();
    const phone = open_database();
    const desktop_client = create_sync_client({ engine, database: () => desktop, storage: memory_storage(), event_stream_retry_ms: 60_000 });
    const phone_client = create_sync_client({ engine, database: () => phone, storage: memory_storage(), event_stream_retry_ms: 60_000 });

    desktop.exec("INSERT INTO notes VALUES ('n1', 'Deadlift 140')");
    await desktop_client.connect(address, "token", "upload");
    await phone_client.connect(address, "token", "download");
    expect(phone.prepare("SELECT text FROM notes").all().map((row) => ({ ...(row as object) }))).toEqual([{ text: "Deadlift 140" }]);

    phone.exec("UPDATE notes SET text = 'Deadlift 150' WHERE id = 'n1'");
    expect((await phone_client.sync_now()).state).toBe("idle");
    await desktop_client.sync_now();
    expect(desktop.prepare("SELECT text FROM notes").get()).toMatchObject({ text: "Deadlift 150" });

    desktop_client.stop();
    phone_client.stop();
  });

  it("asks which copy to keep once the server's data was replaced", async () => {
    const server = open_database();
    const address = await start_server(server);
    const phone = open_database();
    const client = create_sync_client({ engine, database: () => phone, storage: memory_storage(), data_name: "workouts", event_stream_retry_ms: 60_000 });
    await client.connect(address, "token", "download");

    await app.inject({ method: "POST", url: "/api/sync/replace", payload: { changes: [] } });
    const status = await client.sync_now();
    expect(status.state).toBe("needs_setup");
    expect(status.error).toContain("workouts");
    client.stop();
  });
});
