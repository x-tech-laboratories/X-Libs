import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import { migrate, type SqlDatabase } from "../src/sql.ts";
import { create_sync_engine } from "../src/sync_engine.ts";
import { put_file, type SyncFileStore } from "../src/sync_files.ts";
import { create_sync_peer, normalise_address, sync_device_methods, type SyncPeer, type SyncPeerOptions } from "../src/sync_peer.ts";
import { peer_device_header, peer_key_header, type PeerIdentity, type PeerRecord, type PeerStorage } from "../src/sync_protocol.ts";
import { encode_pairing_offer, open_sealed, seal } from "../src/sync_seal.ts";

// ── Devices ──────────────────────────────────────────────────────────────────

const engine = create_sync_engine({ tables: [{ name: "lists", key_columns: ["id"] }, { name: "covers", key_columns: ["id"] }] });

function open_database(): SqlDatabase {
  const database = new DatabaseSync(":memory:");
  migrate(database, ["CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE covers (id TEXT PRIMARY KEY, file TEXT NOT NULL)"]);
  engine.install(database);
  return database;
}

function memory_storage(back_up = vi.fn()): PeerStorage & { back_up: typeof back_up } {
  let identity: PeerIdentity | null = null;
  let peers: PeerRecord[] = [];
  return {
    read_identity: () => identity,
    write_identity: (written) => void (identity = written),
    read_peers: () => peers,
    write_peers: (written) => void (peers = written),
    back_up_before_replace: back_up,
    back_up,
  };
}

function memory_files(): SyncFileStore {
  const files = new Map<string, Uint8Array>();
  return { read: async (name) => files.get(name), write: async (name, bytes) => void files.set(name, bytes), has: async (name) => files.has(name) };
}

// Delivers each call to the device answering at the address's origin, as the network would.
class Network {
  devices = new Map<string, SyncPeer>();
  down = new Set<string>();

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const device = this.devices.get(url.origin);
    if (!device || this.down.has(url.origin)) throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    const headers = init?.headers as Record<string, string>;
    const reply = await device.answer({ device: headers[peer_device_header]!, key: headers[peer_key_header], body: new Uint8Array(init!.body as Uint8Array) });
    return new Response(reply.body as BodyInit, { status: reply.status });
  };
}

interface Device {
  peer: SyncPeer;
  database: SqlDatabase;
  storage: ReturnType<typeof memory_storage>;
  files: SyncFileStore;
}

function device(network: Network, name: string, address: string | null, extra: Partial<SyncPeerOptions> = {}): Device {
  const database = open_database();
  const storage = memory_storage();
  const files = memory_files();
  const peer = create_sync_peer({
    app: "x-test",
    engine,
    database: () => database,
    storage,
    device_name: name,
    addresses: () => (address ? [address] : []),
    files: { store: files, referenced: (opened) => (opened.prepare("SELECT file FROM covers").all() as { file: string }[]).map((row) => row.file) },
    fetch: network.fetch,
    retry_after_failure_ms: 0,
    ...extra,
  });
  if (address) network.devices.set(new URL(address).origin, peer);
  return { peer, database, storage, files };
}

function names(database: SqlDatabase): string[] {
  return (database.prepare("SELECT name FROM lists ORDER BY id").all() as { name: string }[]).map((row) => row.name);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sync peer pairing", () => {
  it("pairs two devices with a code and merges both copies, the newest write of each value winning", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    desktop.database.exec("INSERT INTO lists VALUES ('l1', 'Older name'), ('l2', 'Desk only')");
    await new Promise((resolve) => setTimeout(resolve, 5));
    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Newer name'), ('l3', 'Phone only')");

    const status = await phone.peer.pair_device(desktop.peer.create_pairing_code().code);

    expect(names(phone.database)).toEqual(["Newer name", "Desk only", "Phone only"]);
    expect(names(desktop.database)).toEqual(["Newer name", "Desk only", "Phone only"]);
    expect(status.peers.map((peer) => [peer.name, peer.state])).toEqual([["Desktop", "idle"]]);
    expect(desktop.peer.get_status().peers.map((peer) => peer.name)).toEqual(["Phone"]);
  });

  it("refuses a used code, a code of another app, its own code, and a mistyped one", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    const laptop = device(network, "Laptop", null);
    const { code } = desktop.peer.create_pairing_code();
    await phone.peer.pair_device(code);

    await expect(laptop.peer.pair_device(code)).rejects.toThrow("used already");
    await expect(desktop.peer.pair_device(code)).rejects.toThrow("made on this device");
    await expect(laptop.peer.pair_device("x-sync:nonsense")).rejects.toThrow("mistyped");
    await expect(laptop.peer.pair_device("hello")).rejects.toThrow("not a pairing code");
    const offer = { app: "x-other", device: desktop.peer.device, public_key: "", name: "Desktop", addresses: [], secret: "" };
    await expect(laptop.peer.pair_device(encode_pairing_offer(offer))).rejects.toThrow("key does not match");
    expect(() => phone.peer.create_pairing_code()).toThrow("cannot reach this one");
  });

  it("lets a code run out", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/", { pairing_code_ms: -1 });
    const phone = device(network, "Phone", null);
    await expect(phone.peer.pair_device(desktop.peer.create_pairing_code().code)).rejects.toThrow("ran out");
  });
});

describe("sync peer group", () => {
  it("introduces devices to each other and passes changes on through a device both reach", async () => {
    const network = new Network();
    const server = device(network, "Server", "https://tasks.example.org/api/");
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    await desktop.peer.pair_device(server.peer.create_pairing_code().code);
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);

    // The phone learnt of the server from the desktop; the server learns of the phone on the desktop's next exchange.
    expect(phone.peer.get_status().peers.map((peer) => peer.name).sort()).toEqual(["Desktop", "Server"]);
    await desktop.peer.sync_now();
    expect(server.peer.get_status().peers.map((peer) => peer.name).sort()).toEqual(["Desktop", "Phone"]);

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'From the phone')");
    network.down.add("https://tasks.example.org");
    await phone.peer.sync_now();
    await desktop.peer.sync_now();
    network.down.clear();
    await desktop.peer.sync_now();
    expect(names(server.database)).toEqual(["From the phone"]);

    server.database.exec("UPDATE lists SET name = 'From the server'");
    await phone.peer.sync_now();
    expect(names(phone.database)).toEqual(["From the server"]);
    expect(phone.peer.get_status().pending_changes).toBe(0);
  });

  it("refuses a removed device, and the removal reaches the rest of the group", async () => {
    const network = new Network();
    const server = device(network, "Server", "https://tasks.example.org/api/");
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    await desktop.peer.pair_device(server.peer.create_pairing_code().code);
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);
    await desktop.peer.sync_now();

    desktop.peer.remove_device(phone.peer.device);
    await desktop.peer.sync_now();
    expect(server.peer.get_status().peers.map((peer) => peer.name)).toEqual(["Desktop"]);

    phone.database.exec("INSERT INTO lists VALUES ('l1', 'Lost phone')");
    const status = await phone.peer.sync_now();
    expect(status.state).toBe("failed");
    expect(status.error).toContain("not paired");
    expect(names(desktop.database)).toEqual([]);
  });

  it("tells a device it cannot reach apart from one that refused it", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);

    network.down.add("http://desktop.lan:3920");
    const status = await phone.peer.sync_now();
    expect(status.state).toBe("offline");
    expect(status.error).toContain("ECONNREFUSED");
  });
});

describe("sync peer calls", () => {
  it("refuses a call from an unpaired device, a call sealed for another device, and a replayed one", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    const stranger = device(network, "Stranger", null);
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);

    const unpaired = await desktop.peer.answer({ device: stranger.peer.device, body: new Uint8Array(40) });
    expect(unpaired.status).toBe(403);

    const phone_keys = phone.storage.read_identity()!;
    const desktop_key = desktop.storage.read_identity()!.public_key;
    const garbled = await desktop.peer.answer({ device: phone.peer.device, body: new Uint8Array(64) });
    expect(garbled).toMatchObject({ status: 400, body: "the call was not sealed for this device" });

    const elsewhere = seal({ to: "SOMEONE-ELSE", at: Date.now(), call: "snapshot", args: {} }, undefined, desktop_key, phone_keys.secret_key);
    expect((await desktop.peer.answer({ device: phone.peer.device, body: elsewhere.body })).status).toBe(400);

    const once = seal({ to: desktop.peer.device, at: Date.now(), call: "snapshot", args: {} }, undefined, desktop_key, phone_keys.secret_key);
    expect((await desktop.peer.answer({ device: phone.peer.device, body: once.body })).status).toBe(200);
    expect(await desktop.peer.answer({ device: phone.peer.device, body: once.body })).toMatchObject({ status: 400, body: "the call was already answered" });

    const stale = seal({ to: desktop.peer.device, at: Date.now() - 60 * 60_000, call: "snapshot", args: {} }, undefined, desktop_key, phone_keys.secret_key);
    expect((await desktop.peer.answer({ device: phone.peer.device, body: stale.body })).status).toBe(400);

    const stranger_keys = stranger.storage.read_identity()!;
    const not_pairing = seal({ to: desktop.peer.device, at: Date.now(), call: "snapshot", args: {} }, undefined, desktop_key, stranger_keys.secret_key);
    expect((await desktop.peer.answer({ device: stranger.peer.device, key: stranger_keys.public_key, body: not_pairing.body })).status).toBe(403);
  });

  it("refuses calls it cannot carry out in plain words, and answers a wait with nothing changed", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);
    const phone_keys = phone.storage.read_identity()!;
    const desktop_key = desktop.storage.read_identity()!.public_key;

    async function ask(call: string, args: unknown): Promise<unknown> {
      const sealed = seal({ to: desktop.peer.device, at: Date.now(), call, args }, undefined, desktop_key, phone_keys.secret_key);
      const reply = await desktop.peer.answer({ device: phone.peer.device, body: sealed.body });
      return open_sealed(reply.body as Uint8Array, desktop_key, phone_keys.secret_key)?.json;
    }

    expect(await ask("exchange", { changes: "none" })).toMatchObject({ error: "send site, generation, cursor and a list of changes" });
    expect(await ask("files_missing", { names: ["../db"] })).toMatchObject({ error: "send the names of files as sha256 hex" });
    expect(await ask("file_get", { name: "nope" })).toMatchObject({ error: "a file's name is the sha256 of its bytes" });
    expect(await ask("file_get", { name: "0".repeat(64) })).toMatchObject({ result: { found: false } });
    expect(await ask("file_put", { name: "bad" })).toMatchObject({ error: "a file's name is the sha256 of its bytes" });
    expect(await ask("pair", { secret: "wrong", me: {} })).toMatchObject({ error: expect.stringContaining("ran out") });
    const state = engine.read_state(desktop.database);
    expect(await ask("wait", { cursor: { generation: state.generation, seq: state.last_seq }, wait_ms: 0 })).toMatchObject({ result: { changed: false } });
  });

  it("makes every device match a restored copy once, each keeping a copy first", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    desktop.database.exec("INSERT INTO lists VALUES ('l1', 'Kept')");
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);
    desktop.database.exec("INSERT INTO lists VALUES ('l2', 'Added after the backup')");
    await phone.peer.sync_now();
    expect(names(phone.database)).toEqual(["Kept", "Added after the backup"]);

    // A restore puts back the data the backup held, then forgets the history.
    phone.database.exec("DELETE FROM lists WHERE id = 'l2'");
    engine.forget_history(phone.database);
    await phone.peer.sync_now();

    expect(names(desktop.database)).toEqual(["Kept"]);
    expect(desktop.storage.back_up).toHaveBeenCalledTimes(1);
    await phone.peer.sync_now();
    expect(desktop.storage.back_up).toHaveBeenCalledTimes(1);
  });

  it("sends a device's changes again from the start after its counter started over", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    phone.database.exec("INSERT INTO lists VALUES ('l1', 'From the phone')");
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);

    desktop.database.exec("DELETE FROM lists");
    engine.write_state(desktop.database, { generation: "restarted" });
    desktop.database.exec("DELETE FROM sync_cells");
    await phone.peer.sync_now();
    await phone.peer.sync_now();
    expect(names(desktop.database)).toEqual(["From the phone"]);
  });

  it("moves the files the rows name both ways", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    const from_phone = await put_file(phone.files, new TextEncoder().encode("phone photo"));
    const from_desktop = await put_file(desktop.files, new TextEncoder().encode("desktop cover"));
    phone.database.prepare("INSERT INTO covers VALUES ('c1', ?)").run(from_phone);
    desktop.database.prepare("INSERT INTO covers VALUES ('c2', ?)").run(from_desktop);

    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);

    expect(await desktop.files.has(from_phone)).toBe(true);
    expect(new TextDecoder().decode(await phone.files.read(from_desktop))).toBe("desktop cover");
  });

  it("hears of the other device's changes at once while it runs", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const on_remote_change = vi.fn();
    const phone = device(network, "Phone", null, { wait_ms: 200, on_remote_change, full_sync_ms: 60_000 });
    await phone.peer.pair_device(desktop.peer.create_pairing_code().code);

    phone.peer.start();
    try {
      desktop.database.exec("INSERT INTO lists VALUES ('l1', 'Heard at once')");
      await vi.waitFor(() => expect(names(phone.database)).toEqual(["Heard at once"]), { timeout: 3000 });
      expect(on_remote_change).toHaveBeenCalled();
    } finally {
      phone.peer.stop();
    }
  });

  it("answers the page's calls under their bridge names, and takes addresses found on the network", async () => {
    const network = new Network();
    const desktop = device(network, "Desktop", "http://desktop.lan:3920/");
    const phone = device(network, "Phone", null);
    const methods = sync_device_methods(phone.peer);
    expect(methods.get_sync_status().state).toBe("off");
    await methods.pair_device(desktop.peer.create_pairing_code().code);

    network.devices.set("http://192.168.1.9:3920", desktop.peer);
    network.down.add("http://desktop.lan:3920");
    phone.peer.found_address(desktop.peer.device, "http://192.168.1.9:3920");
    expect((await methods.sync_now()).state).toBe("idle");
    expect(methods.remove_device(desktop.peer.device).state).toBe("off");
    expect(() => normalise_address("ftp://desktop.lan")).toThrow("http://");
  });
});
