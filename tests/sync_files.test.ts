import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { file_response } from "../src/electron/file_protocol.ts";
import { folder_file_store } from "../src/node_file_store.ts";
import { register_sync_routes } from "../src/server/sync_routes.ts";
import type { SqlDatabase } from "../src/sql.ts";
import { create_sync_client, type SyncConfig } from "../src/sync_client.ts";
import { create_sync_engine } from "../src/sync_engine.ts";
import { hash_bytes, is_file_name, put_file } from "../src/sync_files.ts";

const engine = create_sync_engine({ tables: [{ name: "covers", key_columns: ["id"] }] });
const bytes_of = (text: string) => new TextEncoder().encode(text);

let folders: string[] = [];
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  folders = [];
});

function temp_store() {
  const folder = mkdtempSync(join(tmpdir(), "x-libs-files-"));
  folders.push(folder);
  return Object.assign(folder_file_store(join(folder, "files")), { folder: join(folder, "files") });
}

function open_database(): SqlDatabase {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE covers (id TEXT PRIMARY KEY, file TEXT NOT NULL DEFAULT '')");
  engine.install(database);
  return database;
}

function memory_storage() {
  let config: SyncConfig | null = null;
  return {
    read_config: () => config,
    write_config: (next: SyncConfig) => {
      config = next;
    },
    remove_config: () => {
      config = null;
    },
    back_up_before_download: () => undefined,
  };
}

const referenced = (database: SqlDatabase) => database.prepare("SELECT file FROM covers").all().map((row) => String((row as { file: string }).file));

async function start_server(server_files: ReturnType<typeof temp_store>): Promise<string> {
  const server = open_database();
  app = fastify({ forceCloseConnections: true });
  await app.register(async (api) => register_sync_routes(api, { engine, database: () => server, files: server_files }), { prefix: "/api" });
  return app.listen({ port: 0, host: "127.0.0.1" });
}

describe("file names", () => {
  it("names a file by the sha256 of its bytes", async () => {
    const name = await hash_bytes(bytes_of("abc"));
    expect(name).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(is_file_name(name)).toBe(true);
    expect(is_file_name("../media.db")).toBe(false);
  });

  it("keeps a file once in a folder and refuses a name that could leave it", async () => {
    const store = temp_store();
    const name = await put_file(store, bytes_of("cover"));
    await put_file(store, bytes_of("cover"));

    expect(await store.has(name)).toBe(true);
    expect(new TextDecoder().decode(await store.read(name))).toBe("cover");
    expect(readdirSync(store.folder)).toEqual([name]);
    expect(() => store.path_of("../media.db")).toThrow();
  });

  it("answers a file by its name for a desktop page's scheme", async () => {
    const store = temp_store();
    const name = await put_file(store, bytes_of("cover"));

    expect(await (await file_response(store, `x-cover://${name}`)).text()).toBe("cover");
    expect((await file_response(store, "x-cover://nothing")).status).toBe(404);
  });
});

describe("file routes", () => {
  it("lists the files it lacks, keeps a file only under its own hash and hands it back", async () => {
    const server_files = temp_store();
    await start_server(server_files);
    const name = await hash_bytes(bytes_of("cover"));

    const missing = await app!.inject({ method: "POST", url: "/api/sync/files/missing", payload: { names: [name] } });
    expect(missing.json()).toEqual({ missing: [name] });

    const forged = await app!.inject({ method: "PUT", url: `/api/sync/files/${name}`, headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("other") });
    expect(forged.statusCode).toBe(400);

    const sent = await app!.inject({ method: "PUT", url: `/api/sync/files/${name}`, headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("cover") });
    expect(sent.statusCode).toBe(204);
    expect((await app!.inject({ method: "GET", url: `/api/sync/files/${name}` })).body).toBe("cover");
    expect((await app!.inject({ method: "GET", url: "/api/sync/files/nothing" })).statusCode).toBe(400);
  });
});

describe("sync client with files", () => {
  it("sends the files a device's rows name to the server and fetches them onto another device", async () => {
    const server_files = temp_store();
    const address = await start_server(server_files);
    const desktop = open_database();
    const phone = open_database();
    const desktop_files = temp_store();
    const phone_files = temp_store();
    let phone_heard = 0;
    const desktop_client = create_sync_client({ engine, database: () => desktop, storage: memory_storage(), files: { store: desktop_files, referenced }, event_stream_retry_ms: 60_000, full_sync_ms: 1e9 });
    const phone_client = create_sync_client({ engine, database: () => phone, storage: memory_storage(), files: { store: phone_files, referenced }, event_stream_retry_ms: 60_000, full_sync_ms: 1e9, on_remote_change: () => phone_heard++ });

    const name = await put_file(desktop_files, bytes_of("cover"));
    desktop.prepare("INSERT INTO covers (id, file) VALUES ('c1', ?)").run(name);
    await desktop_client.connect(address, "token", "upload");
    await desktop_client.sync_now();
    expect(await server_files.has(name)).toBe(true);

    await phone_client.connect(address, "token", "download");
    expect((await phone_client.sync_now()).state).toBe("idle");
    expect(new TextDecoder().decode(await phone_files.read(name))).toBe("cover");
    expect(phone_heard).toBeGreaterThan(0);

    desktop_client.stop();
    phone_client.stop();
  });

  it("waits for a file the server does not have yet", async () => {
    const address = await start_server(temp_store());
    const phone = open_database();
    const phone_files = temp_store();
    const client = create_sync_client({ engine, database: () => phone, storage: memory_storage(), files: { store: phone_files, referenced }, event_stream_retry_ms: 60_000, full_sync_ms: 1e9 });
    const name = await hash_bytes(bytes_of("not sent"));
    phone.prepare("INSERT INTO covers (id, file) VALUES ('c1', ?)").run(name);

    await client.connect(address, "token", "upload");
    expect((await client.sync_now()).state).toBe("idle");
    expect(await phone_files.has(name)).toBe(false);
    client.stop();
  });
});
