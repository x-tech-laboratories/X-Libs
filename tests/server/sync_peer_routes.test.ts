import { DatabaseSync } from "node:sqlite";

import fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { listen_for_peers, reachable_addresses, register_sync_peer_routes, type PeerListener } from "../../src/server/sync_peer_routes.ts";
import type { SqlDatabase } from "../../src/sql.ts";
import { create_sync_engine } from "../../src/sync_engine.ts";
import { hash_bytes, put_file, type SyncFileStore } from "../../src/sync_files.ts";
import { create_sync_peer, type SyncPeer } from "../../src/sync_peer.ts";
import { peer_device_header, type PeerIdentity, type PeerRecord, type PeerStorage } from "../../src/sync_protocol.ts";
import { open_sealed, seal } from "../../src/sync_seal.ts";

const engine = create_sync_engine({ tables: [{ name: "covers", key_columns: ["id"] }] });

function open_database(): SqlDatabase {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE covers (id TEXT PRIMARY KEY, file TEXT NOT NULL)");
  engine.install(database);
  return database;
}

function memory_storage(): PeerStorage {
  let identity: PeerIdentity | null = null;
  let peers: PeerRecord[] = [];
  return {
    read_identity: () => identity,
    write_identity: (written) => void (identity = written),
    read_peers: () => peers,
    write_peers: (written) => void (peers = written),
    back_up_before_replace: () => {},
  };
}

function memory_files(): SyncFileStore {
  const files = new Map<string, Uint8Array>();
  return { read: async (name) => files.get(name), write: async (name, bytes) => void files.set(name, bytes), has: async (name) => files.has(name) };
}

function peer_on(database: SqlDatabase, storage: PeerStorage, files: SyncFileStore, address: () => string[]): SyncPeer {
  const referenced = (opened: SqlDatabase) => (opened.prepare("SELECT file FROM covers").all() as { file: string }[]).map((row) => row.file);
  return create_sync_peer({ app: "x-test", engine, database: () => database, storage, device_name: "Device", addresses: address, files: { store: files, referenced } });
}

let listener: PeerListener | undefined;

afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

describe("sync peer routes", () => {
  it("syncs rows and files over a real listener, the phone only reaching out", async () => {
    let port = 0;
    const desktop_database = open_database();
    const desktop_files = memory_files();
    const desktop = peer_on(desktop_database, memory_storage(), desktop_files, () => [`http://127.0.0.1:${port}/`]);
    listener = await listen_for_peers({ peer: desktop, host: "127.0.0.1", port: 0 });
    port = listener.port;

    const phone_database = open_database();
    const phone_files = memory_files();
    const name = await put_file(phone_files, new TextEncoder().encode("phone photo"));
    phone_database.prepare("INSERT INTO covers VALUES ('c1', ?)").run(name);
    const phone = peer_on(phone_database, memory_storage(), phone_files, () => []);

    await phone.pair_device(desktop.create_pairing_code().code);

    expect(desktop_database.prepare("SELECT file FROM covers").all()).toEqual([{ file: name }]);
    expect(await hash_bytes((await desktop_files.read(name))!)).toBe(name);
  });

  it("refuses a body that is not a sealed call, and a call from a device it does not know", async () => {
    const app = fastify();
    const storage = memory_storage();
    const peer = peer_on(open_database(), storage, memory_files(), () => []);
    register_sync_peer_routes(app, peer);

    const plain = await app.inject({ method: "POST", url: "/sync/peer", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(plain.statusCode).toBe(400);
    const unknown = await app.inject({ method: "POST", url: "/sync/peer", headers: { "content-type": "application/octet-stream", [peer_device_header]: "NOBODY" }, payload: Buffer.alloc(64) });
    expect(unknown.statusCode).toBe(403);
    await app.close();
  });

  it("answers a sealed call with a sealed answer, refusing in plain words what the call got wrong", async () => {
    const app = fastify();
    const desktop_storage = memory_storage();
    const desktop = peer_on(open_database(), desktop_storage, memory_files(), () => ["http://desktop.lan:3920/"]);
    register_sync_peer_routes(app, desktop);
    const phone_storage = memory_storage();
    const phone = peer_on(open_database(), phone_storage, memory_files(), () => []);

    // The test seals the pairing call by hand, since the app is reached through inject rather than the network.
    const desktop_key = desktop_storage.read_identity()!.public_key;
    const phone_keys = phone_storage.read_identity()!;
    const { code } = desktop.create_pairing_code();
    const secret = JSON.parse(atob(code.slice("x-sync:".length).replaceAll("-", "+").replaceAll("_", "/"))).secret as string;
    const me: PeerRecord = { device: phone.device, public_key: phone_keys.public_key, name: "Phone", addresses: [], updated_at: 1, removed: false };
    const pairing = seal({ to: desktop.device, at: Date.now(), call: "pair", args: { secret, me } }, undefined, desktop_key, phone_keys.secret_key);
    const paired = await app.inject({
      method: "POST",
      url: "/sync/peer",
      headers: { "content-type": "application/octet-stream", [peer_device_header]: phone.device, "x-sync-key": phone_keys.public_key },
      payload: Buffer.from(pairing.body),
    });
    expect(paired.statusCode).toBe(200);
    expect(open_sealed(new Uint8Array(paired.rawPayload), desktop_key, phone_keys.secret_key)?.json).toMatchObject({ reply_to: pairing.nonce });

    const bad_file = seal({ to: desktop.device, at: Date.now(), call: "file_put", args: { name: "0".repeat(64) } }, new TextEncoder().encode("other bytes"), desktop_key, phone_keys.secret_key);
    const refused = await app.inject({ method: "POST", url: "/sync/peer", headers: { "content-type": "application/octet-stream", [peer_device_header]: phone.device }, payload: Buffer.from(bad_file.body) });
    expect(open_sealed(new Uint8Array(refused.rawPayload), desktop_key, phone_keys.secret_key)?.json).toMatchObject({ error: "the bytes do not match the name" });
    await app.close();
  });

  it("lists the computer's addresses other devices can reach, leaving out loopback and link-local ones", () => {
    const interfaces = {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      eth0: [
        { address: "192.168.1.5", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "fd7a:115c::5", family: "IPv6", internal: false },
      ],
    } as unknown as Parameters<typeof reachable_addresses>[1];
    expect(reachable_addresses(3920, interfaces)).toEqual(["http://192.168.1.5:3920/", "http://[fd7a:115c::5]:3920/"]);
  });
});
