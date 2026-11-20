// The list of daemons a desktop or phone app connects to, the way Deluge's connection manager keeps one: the local
// daemon where the app offers it, and daemons on other hosts, each signed in once as this device for a token of its
// own. It runs wherever fetch does, a desktop app's main process or a phone's page, and keeps the list through a
// storage the app gives, such as `connection_file_storage` or `web/connection_storage`. Tokens stay here; the page
// only ever sees `ConnectionSummary`.

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  connection_address, LOCAL_CONNECTION_ID,
  type ConnectionCredentials, type ConnectionMethods, type ConnectionStorage, type ConnectionSummary, type ConnectionsView, type SavedConnection, type SavedConnections,
} from "./connection_protocol.ts";

export type { ConnectionStorage, SavedConnection, SavedConnections } from "./connection_protocol.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// Where the app's calls go now: the local daemon, a remote one with its token, or nowhere while none is chosen.
export type CurrentDaemon = { kind: "local" } | { kind: "remote"; id: string; address: string; token: string } | null;

export interface ConnectionsOptions {
  storage: ConnectionStorage;
  // Whether the app runs a local daemon of its own; false for a portal app, such as X-Nix, and on a phone.
  offers_local: boolean;
  // What the device is called on each daemon's token list, such as "X-Tasks on laptop".
  device_name: string;
  // What the local daemon is called; "This computer" unless set.
  local_name?: string;
  // Paths of the daemon's sign-in and sign-out, under its address.
  login_path?: string;
  logout_path?: string;
  // Sends the sign-in and sign-out, such as through a fetch that trusts certificates the user accepted.
  fetch?: typeof fetch;
  make_id?: () => string;
}

export type Connections = ReturnType<typeof create_connections>;

// ── Connections ──────────────────────────────────────────────────────────────

export function create_connections(options: ConnectionsOptions) {
  const { storage, offers_local, device_name } = options;
  const local_name = options.local_name ?? "This computer";
  const login_path = options.login_path ?? "/api/login";
  const logout_path = options.logout_path ?? "/api/logout";
  const do_fetch = options.fetch ?? fetch;
  const make_id = options.make_id ?? (() => crypto.randomUUID());
  const listeners = new Set<(daemon: CurrentDaemon) => void>();

  let saved: SavedConnections = storage.read() ?? { current: null, remotes: [] };

  // The current id kept, or the one to fall back to when it is gone: the local daemon, then the first remote one.
  function current_id(): string | null {
    const kept = saved.current;
    if (kept === LOCAL_CONNECTION_ID && offers_local) return kept;
    if (kept !== null && saved.remotes.some((remote) => remote.id === kept)) return kept;
    if (offers_local) return LOCAL_CONNECTION_ID;
    return saved.remotes[0]?.id ?? null;
  }

  function current(): CurrentDaemon {
    const id = current_id();
    if (id === null) return null;
    if (id === LOCAL_CONNECTION_ID) return { kind: "local" };
    const remote = saved.remotes.find((each) => each.id === id)!;
    return { kind: "remote", id, address: remote.address, token: remote.token };
  }

  function view(): ConnectionsView {
    const local: ConnectionSummary[] = offers_local ? [{ id: LOCAL_CONNECTION_ID, name: local_name, kind: "local", address: "", user: "" }] : [];
    const remotes = saved.remotes.map(({ id, name, address, user }): ConnectionSummary => ({ id, name, kind: "remote", address, user }));
    return { connections: [...local, ...remotes], current: current_id() };
  }

  // Saves the list, telling listeners when the daemon the app talks to has changed.
  function save(next: SavedConnections): ConnectionsView {
    const before = JSON.stringify(current());
    saved = next;
    storage.write(saved);
    const after = current();
    if (JSON.stringify(after) !== before) for (const listener of listeners) listener(after);
    return view();
  }

  function remote_of(id: string): SavedConnection {
    const remote = saved.remotes.find((each) => each.id === id);
    if (!remote) throw new Error(id === LOCAL_CONNECTION_ID ? "This computer's daemon cannot be changed here." : "There is no such daemon.");
    return remote;
  }

  // ── Signing in and out ─────────────────────────────────────────────────

  // Signs this device in to the daemon for a token of its own; a refusal keeps the daemon's words, such as asking for the code.
  async function sign_in(address: string, credentials: ConnectionCredentials): Promise<string> {
    let response: Response;
    try {
      response = await do_fetch(`${address}${login_path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...credentials, device: device_name }),
      });
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
      throw new Error(`The daemon at ${address} did not answer${cause}.`);
    }
    const answer = await response.json().catch(() => ({})) as { token?: string; error?: string };
    if (!response.ok || !answer.token) throw new Error(answer.error ?? `The daemon answered ${response.status}.`);
    return answer.token;
  }

  // Gives the token back so the daemon forgets this device; a daemon out of reach keeps it until the user revokes it there.
  function sign_out(remote: SavedConnection): void {
    void do_fetch(`${remote.address}${logout_path}`, { method: "POST", headers: { authorization: `Bearer ${remote.token}` } }).catch(() => {});
  }

  // ── Calls ──────────────────────────────────────────────────────────────

  const methods: ConnectionMethods = {
    list_connections: async () => view(),

    // Signing in again to a daemon already listed as the same user only renews its token.
    async add_connection(typed_address, credentials, name) {
      const address = connection_address(typed_address);
      const user = credentials.name.trim().toLowerCase();
      const token = await sign_in(address, credentials);
      const known = saved.remotes.find((remote) => remote.address === address && remote.user === user);
      if (known) {
        sign_out(known);
        return save({ ...saved, remotes: saved.remotes.map((remote) => (remote === known ? { ...known, token } : remote)) });
      }
      const added: SavedConnection = { id: make_id(), name: name?.trim() || new URL(address).host, address, user, token };
      return save({ current: current_id() ?? added.id, remotes: [...saved.remotes, added] });
    },

    async rename_connection(id, name) {
      const remote = remote_of(id);
      const trimmed = name.trim();
      if (trimmed === "") throw new Error("Give the daemon a name.");
      return save({ ...saved, remotes: saved.remotes.map((each) => (each === remote ? { ...remote, name: trimmed } : each)) });
    },

    async remove_connection(id) {
      const remote = remote_of(id);
      sign_out(remote);
      const remotes = saved.remotes.filter((each) => each !== remote);
      return save({ current: saved.current === id ? null : saved.current, remotes });
    },

    async choose_connection(id) {
      if (id === LOCAL_CONNECTION_ID && !offers_local) throw new Error("This app connects only to daemons on other hosts.");
      if (id !== LOCAL_CONNECTION_ID) remote_of(id);
      return save({ ...saved, current: id });
    },
  };

  // Runs the listener whenever the daemon the app talks to changes, such as to follow the new one's events; returns how to stop.
  function subscribe(listener: (daemon: CurrentDaemon) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { current, methods, subscribe };
}
