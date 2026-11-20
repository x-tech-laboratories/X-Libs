// Sync through a host in between, such as a phone syncing with a daemon that syncs with a server, over real loopback listeners.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { register_sync_routes } from "../../src/server/sync_routes.ts";
import { create_sync_client, type SyncClient, type SyncConfig } from "../../src/sync_client.ts";
import { create_sync_engine, type SyncEngine } from "../../src/sync_engine.ts";
import type { SyncChange, SyncExchangeRequest } from "../../src/sync_protocol.ts";

const engine = create_sync_engine({
  tables: [
    { name: "lists", key_columns: ["id"] },
    { name: "items", key_columns: ["id"] },
  ],
});

// ============================================================================
// Hosts
// ============================================================================

interface Exchange {
  sent: SyncChange[];
  received: SyncChange[];
}

interface Host {
  name: string;
  database: DatabaseSync;
  address: string;
  app: FastifyInstance | null;
  client: SyncClient | null;
  exchanges: Exchange[];
  offline: boolean;
  config: SyncConfig | null;
}

const apps: FastifyInstance[] = [];
const clients: SyncClient[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const app of apps.splice(0)) await app.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function open_database(path = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)`);
  engine.install(database);
  return database;
}

function new_host(name: string, database = open_database()): Host {
  return { name, database, address: "", app: null, client: null, exchanges: [], offline: false, config: null };
}

// Serves sync from the host's database, on the given port or a free one.
async function serve(host: Host, port = 0, serving_engine: SyncEngine = engine): Promise<void> {
  const app = fastify({ forceCloseConnections: true });
  await app.register(async (api) => register_sync_routes(api, { engine: serving_engine, database: () => host.database }), { prefix: "/api" });
  host.address = await app.listen({ port, host: "127.0.0.1" });
  host.app = app;
  apps.push(app);
}

// A fetch that fails while the host is offline and keeps what each exchange sent and got back.
function host_fetch(host: Host): typeof fetch {
  return (async (input: URL, init?: RequestInit) => {
    if (host.offline) throw new TypeError("fetch failed");
    const response = await fetch(input, init);
    if (input.pathname.endsWith("/sync/exchange") && response.ok) {
      const request = JSON.parse(String(init?.body)) as SyncExchangeRequest;
      host.exchanges.push({ sent: request.changes, received: ((await response.clone().json()) as { changes: SyncChange[] }).changes });
    }
    return response;
  }) as typeof fetch;
}

// A sync client for the host that syncs only when asked, its sign-in kept on the host so a restart keeps it.
function client_of(host: Host): SyncClient {
  const client = create_sync_client({
    engine,
    database: () => host.database,
    fetch: host_fetch(host),
    local_check_ms: 1e9,
    full_sync_ms: 1e9,
    event_stream_retry_ms: 1e9,
    storage: {
      read_config: () => host.config,
      write_config: (config) => void (host.config = config),
      remove_config: () => void (host.config = null),
      back_up_before_download: () => undefined,
    },
  });
  clients.push(client);
  host.client = client;
  return client;
}

async function follow(host: Host, server: Host, direction: "upload" | "download"): Promise<void> {
  await client_of(host).connect(server.address, "token", direction);
}

async function sync(...hosts: Host[]): Promise<void> {
  for (const host of hosts) expect((await host.client!.sync_now()), host.name).toMatchObject({ state: "idle", error: "" });
}

// Each pass syncs the hosts in order; a change goes one hop per pass in each direction.
async function sync_rounds(rounds: number, ...hosts: Host[]): Promise<void> {
  for (let round = 0; round < rounds; round++) await sync(...hosts);
}

function rows(host: Host, sql: string): unknown[] {
  return host.database.prepare(sql).all().map((row) => ({ ...(row as object) }));
}

function all_data(host: Host): unknown[] {
  return [rows(host, "SELECT * FROM lists ORDER BY id"), rows(host, "SELECT * FROM items ORDER BY id")];
}

function expect_alike(...hosts: Host[]): void {
  for (const host of hosts.slice(1)) expect(all_data(host), host.name).toEqual(all_data(hosts[0]!));
}

function forget_exchanges(...hosts: Host[]): void {
  for (const host of hosts) host.exchanges = [];
}

// Every exchange since the hosts' logs were cleared carried nothing either way.
function expect_quiet(...hosts: Host[]): void {
  for (const host of hosts) for (const exchange of host.exchanges) expect(exchange, host.name).toEqual({ sent: [], received: [] });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// A server, a daemon that syncs with it and serves sync, and a phone that syncs with the daemon.
async function chain(middle_database?: DatabaseSync) {
  const server = new_host("server");
  await serve(server);
  const middle = new_host("middle", middle_database);
  await serve(middle);
  await follow(middle, server, "upload");
  const phone = new_host("phone");
  await follow(phone, middle, "download");
  return { server, middle, phone };
}

// ============================================================================
// A chain of three
// ============================================================================

describe("a host between a phone and the server", () => {
  it("passes the phone's changes on to the server", async () => {
    const { server, middle, phone } = await chain();

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Made on the phone')");
    await sync(phone, middle);

    expect(rows(server, "SELECT name FROM lists")).toEqual([{ name: "Made on the phone" }]);
  });

  it("passes changes both ways, each once and never back to where it came from", async () => {
    const { server, middle, phone } = await chain();

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Phone list')");
    await sync(phone, middle);
    expect(middle.exchanges.at(-1)!.sent.map((change) => change.key)).toEqual(["l1", "l1", "l1"]);
    expect(middle.exchanges.at(-1)!.received).toEqual([]);

    server.database.exec("INSERT INTO lists VALUES ('l2', 'Server list')");
    forget_exchanges(phone, middle);
    await sync(middle, phone);
    expect(middle.exchanges[0]!.received.map((change) => change.key)).toEqual(["l2", "l2", "l2"]);
    expect(phone.exchanges[0]!.received.map((change) => change.key)).toEqual(["l2", "l2", "l2"]);
    expect(phone.exchanges[0]!.sent).toEqual([]);

    forget_exchanges(phone, middle);
    await sync_rounds(3, phone, middle);
    expect_quiet(phone, middle);
    expect_alike(server, middle, phone);
    expect(engine.count_unpushed_rows(middle.database)).toBe(0);
    expect(engine.count_unpushed_rows(phone.database)).toBe(0);
  });

  it("counts the phone's changes as waiting on the host in between until it passes them on", async () => {
    const { middle, phone } = await chain();

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Legs'), ('l2', 'Arms')");
    await sync(phone);

    expect(engine.has_unpushed_changes(middle.database)).toBe(true);
    expect(middle.client!.get_status().pending_changes).toBe(2);
    await sync(middle);
    expect(engine.has_unpushed_changes(middle.database)).toBe(false);
  });

  it("settles edits made on all three at once the same way everywhere, the latest write of each value winning", async () => {
    const { server, middle, phone } = await chain();
    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Legs'); INSERT INTO items (id, list_id, title) VALUES ('i1', 'l1', 'Squat')");
    await sync_rounds(2, phone, middle);

    server.database.exec("UPDATE items SET title = 'Server title', done = 1 WHERE id = 'i1'");
    await wait(5);
    middle.database.exec("UPDATE items SET title = 'Middle title' WHERE id = 'i1'; INSERT INTO lists VALUES ('l2', 'Middle list')");
    await wait(5);
    phone.database.exec("UPDATE items SET title = 'Phone title' WHERE id = 'i1'; UPDATE lists SET name = 'Phone legs' WHERE id = 'l1'");
    await sync_rounds(3, phone, middle);

    expect_alike(server, middle, phone);
    expect(rows(server, "SELECT title, done FROM items")).toEqual([{ title: "Phone title", done: 1 }]);
    expect(rows(server, "SELECT name FROM lists ORDER BY id")).toEqual([{ name: "Phone legs" }, { name: "Middle list" }]);

    forget_exchanges(phone, middle);
    await sync_rounds(2, phone, middle);
    expect_quiet(phone, middle);
  });

  it("carries deletes both ways, with the rows under a deleted one", async () => {
    const { server, middle, phone } = await chain();
    server.database.exec("INSERT INTO lists VALUES ('l1', 'Legs'), ('l2', 'Arms'); INSERT INTO items (id, list_id, title) VALUES ('i1', 'l1', 'Squat'), ('i2', 'l2', 'Curl')");
    await sync_rounds(2, middle, phone);
    expect(rows(phone, "SELECT id FROM items ORDER BY id")).toEqual([{ id: "i1" }, { id: "i2" }]);

    phone.database.exec("DELETE FROM lists WHERE id = 'l1'");
    server.database.exec("DELETE FROM items WHERE id = 'i2'");
    await sync_rounds(3, phone, middle);

    expect_alike(server, middle, phone);
    expect(rows(server, "SELECT id FROM lists")).toEqual([{ id: "l2" }]);
    expect(rows(server, "SELECT * FROM items")).toEqual([]);
  });

  it("brings a phone that was offline up to date, and sends what it changed meanwhile", async () => {
    const { server, middle, phone } = await chain();
    phone.offline = true;

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Written offline')");
    expect((await phone.client!.sync_now()).state).toBe("offline");
    server.database.exec("INSERT INTO lists VALUES ('l2', 'Written meanwhile')");
    await sync(middle);
    phone.offline = false;
    await sync_rounds(2, phone, middle);

    expect_alike(server, middle, phone);
    expect(rows(phone, "SELECT id FROM lists ORDER BY id")).toEqual([{ id: "l1" }, { id: "l2" }]);
  });

  it("catches up when the host in between was offline from the server", async () => {
    const { server, middle, phone } = await chain();
    middle.offline = true;

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'From the phone')");
    await sync(phone);
    expect((await middle.client!.sync_now()).state).toBe("offline");
    server.database.exec("INSERT INTO lists VALUES ('l2', 'From the server')");
    middle.offline = false;
    await sync_rounds(2, middle, phone);

    expect_alike(server, middle, phone);
    expect(rows(server, "SELECT id FROM lists ORDER BY id")).toEqual([{ id: "l1" }, { id: "l2" }]);
  });

  it("goes on passing changes after the host in between restarts, without sending any twice", async () => {
    const folder = mkdtempSync(join(tmpdir(), "x-libs-sync-relay-"));
    folders.push(folder);
    const path = join(folder, "middle.db");
    const { server, middle, phone } = await chain(open_database(path));
    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Before the restart')");
    await sync(phone, middle);

    // The phone's change lands, then the host stops before passing it on.
    phone.database.exec("INSERT INTO lists VALUES ('l2', 'Just before the restart')");
    await sync(phone);
    const port = Number(new URL(middle.address).port);
    middle.client!.stop();
    await middle.app!.close();
    middle.database.close();

    middle.database = open_database(path);
    await serve(middle, port);
    client_of(middle);
    forget_exchanges(middle);
    phone.database.exec("INSERT INTO lists VALUES ('l3', 'After the restart')");
    // The phone's first try may meet the connection the old listener closed, as a real device would, and tries again.
    await phone.client!.sync_now();
    await sync(phone, middle);

    expect(middle.exchanges[0]!.sent.map((change) => change.key)).toEqual(["l2", "l2", "l2", "l3", "l3", "l3"]);
    expect(rows(server, "SELECT id FROM lists ORDER BY id")).toEqual([{ id: "l1" }, { id: "l2" }, { id: "l3" }]);
    forget_exchanges(phone, middle);
    await sync_rounds(2, phone, middle);
    expect_quiet(phone, middle);
    expect_alike(server, middle, phone);
  });

  it("keeps the request and answer the same shape older devices and servers send", async () => {
    const { middle, phone } = await chain();
    const state = engine.read_state(phone.database);

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Legs')");
    const request = { site: state.site, generation: state.server_generation, cursor: 0, changes: engine.collect_unpushed_changes(phone.database).changes };
    const response = await fetch(new URL("api/sync/exchange", phone.config!.server_url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const answer = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(request).sort()).toEqual(["changes", "cursor", "generation", "site"]);
    expect(Object.keys(answer).sort()).toEqual(["changes", "cursor", "generation"]);
    expect(Object.keys(request.changes[0]!).sort()).toEqual(["column", "key", "site", "table", "ts", "value"]);
    expect(rows(middle, "SELECT name FROM lists")).toEqual([{ name: "Legs" }]);
  });

  it("does not pass on again changes an older server sends back to the host that sent them", async () => {
    // An older server leaves out only the changes the asking host made itself, so it sends the phone's back to the host in between.
    const older_engine: SyncEngine = {
      ...engine,
      collect_changes_since: (database, cursor, except_site) => {
        const all = engine.collect_changes_since(database, cursor, "");
        return { ...all, changes: all.changes.filter((change) => change.site !== except_site) };
      },
    };
    const server = new_host("server");
    await serve(server, 0, older_engine);
    const middle = new_host("middle");
    await serve(middle);
    await follow(middle, server, "upload");
    const phone = new_host("phone");
    await follow(phone, middle, "download");

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Phone list')");
    await sync(phone, middle);
    expect(middle.exchanges.at(-1)!.received.map((change) => change.key)).toEqual(["l1", "l1", "l1"]);
    forget_exchanges(phone, middle);
    await sync_rounds(3, middle, phone);

    expect_quiet(phone, middle);
    expect_alike(server, middle, phone);
  });
});

// ============================================================================
// Two hosts in between on one server
// ============================================================================

describe("two hosts in between sharing one server, each with a phone", () => {
  it("brings every change to all five and then falls quiet", async () => {
    const server = new_host("server");
    await serve(server);
    const first = new_host("first daemon");
    const second = new_host("second daemon");
    await serve(first);
    await serve(second);
    first.database.exec("INSERT INTO lists VALUES ('l0', 'Shared from the start')");
    await follow(first, server, "upload");
    await follow(second, server, "download");
    const first_phone = new_host("first phone");
    const second_phone = new_host("second phone");
    await follow(first_phone, first, "download");
    await follow(second_phone, second, "download");
    const all = [first_phone, first, second, second_phone];

    first_phone.database.exec("INSERT INTO lists VALUES ('l1', 'First phone'); UPDATE lists SET name = 'Renamed on the first phone' WHERE id = 'l0'");
    second_phone.database.exec("INSERT INTO lists VALUES ('l2', 'Second phone'); INSERT INTO items (id, list_id, title) VALUES ('i1', 'l0', 'Second phone item')");
    server.database.exec("INSERT INTO lists VALUES ('l3', 'Server')");
    await sync_rounds(4, ...all);

    expect_alike(server, first, second, first_phone, second_phone);
    expect(rows(second_phone, "SELECT id, name FROM lists ORDER BY id")).toEqual([
      { id: "l0", name: "Renamed on the first phone" },
      { id: "l1", name: "First phone" },
      { id: "l2", name: "Second phone" },
      { id: "l3", name: "Server" },
    ]);

    forget_exchanges(...all);
    await sync_rounds(3, ...all);
    expect_quiet(...all);
  });
});
