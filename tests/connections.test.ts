import { describe, expect, it } from "vitest";

import { connection_address, LOCAL_CONNECTION_ID } from "../src/connection_protocol.ts";
import { create_connections, type ConnectionStorage, type CurrentDaemon, type SavedConnections } from "../src/connections.ts";

// ============================================================================
// Helpers
// ============================================================================

function memory_storage(start: SavedConnections | null = null): ConnectionStorage & { saved: SavedConnections | null } {
  const storage = {
    saved: start,
    read: () => storage.saved,
    write: (saved: SavedConnections) => void (storage.saved = saved),
  };
  return storage;
}

interface Sent {
  url: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

// A daemon that signs "ada" in with password "right" and hands out numbered tokens, and asks "bob" for his code.
function fake_daemon() {
  const sent: Sent[] = [];
  let next_token = 1;
  const do_fetch = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    sent.push({ url, body, authorization: headers.get("authorization") });
    if (url.startsWith("https://down.example")) throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    if (url.endsWith("/api/logout")) return new Response(null, { status: 204 });
    if (body?.name === "bob" && !body.code) return Response.json({ error: "Enter the code from your authenticator app.", code_needed: true }, { status: 401 });
    if (body?.password !== "right" && body?.name !== "bob") return Response.json({ error: "Wrong name or password." }, { status: 401 });
    return Response.json({ token: `token-${next_token++}`, id: 1 });
  }) as typeof fetch;
  return { sent, do_fetch };
}

let ids = 0;
const make_id = () => `remote-${++ids}`;

// ============================================================================
// Addresses
// ============================================================================

describe("connection_address", () => {
  it("adds https when no scheme is given and drops the slash at the end, keeping a path and port", () => {
    expect(connection_address(" home.example.org/ ")).toBe("https://home.example.org");
    expect(connection_address("http://nas.lan:8080/x-tasks/")).toBe("http://nas.lan:8080/x-tasks");
  });

  it("refuses an empty address and any scheme but http and https", () => {
    expect(() => connection_address("  ")).toThrow("Enter the daemon's address.");
    expect(() => connection_address("ftp://files.example.org")).toThrow("must start with http:// or https://");
    expect(() => connection_address("home example")).toThrow("is not a daemon's address");
    expect(connection_address("HTTPS://Home.Example.org/Tasks")).toBe("https://home.example.org/Tasks");
  });
});

// ============================================================================
// An app with a local daemon
// ============================================================================

describe("create_connections with a local daemon", () => {
  it("starts on this computer, adds a remote daemon as this device without switching, and never shows its token", async () => {
    const daemon = fake_daemon();
    const storage = memory_storage();
    const connections = create_connections({ storage, offers_local: true, device_name: "X-Tasks on laptop", fetch: daemon.do_fetch, make_id });

    const view = await connections.methods.add_connection("home.example.org", { name: " Ada ", password: "right" });

    expect(view.current).toBe(LOCAL_CONNECTION_ID);
    expect(view.connections.map((each) => each.name)).toEqual(["This computer", "home.example.org"]);
    expect(JSON.stringify(view)).not.toContain("token-1");
    expect(daemon.sent[0]).toEqual({ url: "https://home.example.org/api/login", body: { name: " Ada ", password: "right", device: "X-Tasks on laptop" }, authorization: null });
    expect(storage.saved?.remotes[0]).toMatchObject({ address: "https://home.example.org", user: "ada", token: "token-1" });
    expect(connections.current()).toEqual({ kind: "local" });
  });

  it("tells listeners the new daemon when another is chosen, and falls back to this computer when the chosen one is removed", async () => {
    const daemon = fake_daemon();
    const connections = create_connections({ storage: memory_storage(), offers_local: true, device_name: "laptop", fetch: daemon.do_fetch, make_id });
    const heard: CurrentDaemon[] = [];
    connections.subscribe((current) => heard.push(current));
    const added = await connections.methods.add_connection("https://home.example.org", { name: "ada", password: "right" }, "Home server");
    const id = added.connections[1]!.id;

    await connections.methods.choose_connection(id);
    const after_remove = await connections.methods.remove_connection(id);

    expect(heard).toEqual([{ kind: "remote", id, address: "https://home.example.org", token: "token-1" }, { kind: "local" }]);
    expect(after_remove.current).toBe(LOCAL_CONNECTION_ID);
    expect(daemon.sent.at(-1)).toEqual({ url: "https://home.example.org/api/logout", body: null, authorization: "Bearer token-1" });
  });

  it("renews the token when the same user adds the same daemon again, giving the old one back", async () => {
    const daemon = fake_daemon();
    const storage = memory_storage();
    const connections = create_connections({ storage, offers_local: true, device_name: "laptop", fetch: daemon.do_fetch, make_id });
    await connections.methods.add_connection("home.example.org", { name: "ada", password: "right" });

    const view = await connections.methods.add_connection("https://home.example.org/", { name: "ADA", password: "right" });

    expect(view.connections).toHaveLength(2);
    expect(storage.saved?.remotes[0]?.token).toBe("token-2");
    expect(daemon.sent.some((each) => each.url.endsWith("/api/logout") && each.authorization === "Bearer token-1")).toBe(true);
  });

  it("renames a remote daemon, refusing an empty name and the local daemon", async () => {
    const connections = create_connections({ storage: memory_storage(), offers_local: true, device_name: "laptop", fetch: fake_daemon().do_fetch, make_id });
    const id = (await connections.methods.add_connection("home.example.org", { name: "ada", password: "right" })).connections[1]!.id;

    const view = await connections.methods.rename_connection(id, "  Attic NAS ");

    expect(view.connections[1]!.name).toBe("Attic NAS");
    await expect(connections.methods.rename_connection(id, " ")).rejects.toThrow("Give the daemon a name.");
    await expect(connections.methods.rename_connection(LOCAL_CONNECTION_ID, "Mine")).rejects.toThrow("cannot be changed here");
    await expect(connections.methods.remove_connection(LOCAL_CONNECTION_ID)).rejects.toThrow("cannot be changed here");
  });

  it("keeps the list in its storage, so a new start opens on the daemon chosen last", async () => {
    const storage = memory_storage();
    const first = create_connections({ storage, offers_local: true, device_name: "laptop", fetch: fake_daemon().do_fetch, make_id });
    const id = (await first.methods.add_connection("home.example.org", { name: "ada", password: "right" })).connections[1]!.id;
    await first.methods.choose_connection(id);

    const second = create_connections({ storage, offers_local: true, device_name: "laptop", fetch: fake_daemon().do_fetch, make_id });

    expect((await second.methods.list_connections()).current).toBe(id);
    expect(second.current()).toMatchObject({ kind: "remote", address: "https://home.example.org", token: "token-1" });
  });
});

// ============================================================================
// A portal app
// ============================================================================

describe("create_connections for a portal app", () => {
  it("has no daemon until one is added, which it then talks to, and refuses this computer", async () => {
    const connections = create_connections({ storage: memory_storage(), offers_local: false, device_name: "X-Nix on phone", fetch: fake_daemon().do_fetch, make_id });
    expect(connections.current()).toBeNull();
    expect((await connections.methods.list_connections()).connections).toEqual([]);

    const view = await connections.methods.add_connection("nix.example.org", { name: "ada", password: "right" });

    expect(view.current).toBe(view.connections[0]!.id);
    expect(connections.current()).toMatchObject({ kind: "remote", address: "https://nix.example.org" });
    await expect(connections.methods.choose_connection(LOCAL_CONNECTION_ID)).rejects.toThrow("only to daemons on other hosts");
  });
});

// ============================================================================
// Refusals
// ============================================================================

describe("signing in to a daemon", () => {
  it("passes on the daemon's own words, so the page can ask for the code", async () => {
    const connections = create_connections({ storage: memory_storage(), offers_local: true, device_name: "laptop", fetch: fake_daemon().do_fetch, make_id });

    await expect(connections.methods.add_connection("home.example.org", { name: "ada", password: "wrong" })).rejects.toThrow("Wrong name or password.");
    await expect(connections.methods.add_connection("home.example.org", { name: "bob", password: "right" })).rejects.toThrow("Enter the code from your authenticator app.");
    await expect(connections.methods.add_connection("home.example.org", { name: "bob", password: "right", code: "123456" })).resolves.toMatchObject({ connections: [{}, { user: "bob" }] });
  });

  it("says which daemon did not answer and why", async () => {
    const connections = create_connections({ storage: memory_storage(), offers_local: true, device_name: "laptop", fetch: fake_daemon().do_fetch, make_id });

    await expect(connections.methods.add_connection("down.example", { name: "ada", password: "right" })).rejects.toThrow("The daemon at https://down.example did not answer: connect ECONNREFUSED.");
  });
});
