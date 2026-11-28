// One device's side of sync with no server: every copy of the app's data is a peer of the others. It pairs with another
// device through a one-time code, then sends each paired device its changes within seconds, takes theirs in the same
// round trip, hears of their changes at once through a waiting call, and passes on what it took from the others, so
// devices that never reach each other still end up alike. The copies merge value by value, the newest write winning.
// A device the others can reach answers their calls too; the calls are the same whichever side starts them. It runs
// wherever fetch does: a desktop daemon, a server, or a phone's page.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { SqlDatabase } from "./sql.ts";
import type { SyncEngine } from "./sync_engine.ts";
import { hash_bytes, is_file_name, type SyncFilesOptions } from "./sync_files.ts";
import {
  is_change_list,
  peer_device_header,
  peer_key_header,
  sync_peer_path,
  type PairingCode,
  type PeerAnswerBody,
  type PeerCallBody,
  type PeerCallName,
  type PeerCalls,
  type PeerExchangeRequest,
  type PeerIdentity,
  type PeerRecord,
  type PeerState,
  type PeerStatus,
  type PeerStorage,
  type SyncDeviceMethods,
  type SyncStatus,
} from "./sync_protocol.ts";
import { create_identity, decode_pairing_offer, device_id_of, encode_pairing_offer, open_sealed, random_secret, seal } from "./sync_seal.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface SyncPeerOptions {
  // The app's id, such as "x-tasks", so a code made by another app is refused.
  app: string;
  engine: SyncEngine;
  database: () => SqlDatabase;
  storage: PeerStorage;
  // What the other devices list this one as, such as "X-Tasks on laptop".
  device_name: string;
  // Files the rows name, such as covers, sent and fetched after each exchange of changes.
  files?: SyncFilesOptions<SqlDatabase>;
  // Where other devices can reach this one, such as "http://192.168.1.5:3920/"; none when it only reaches out.
  addresses?: () => string[];
  // Runs whenever changes from elsewhere land in the database, or files they name arrive.
  on_remote_change?: () => void;
  // Runs whenever the status changes, for a page that shows it.
  on_status?: (status: SyncStatus) => void;
  fetch?: typeof fetch;
  local_check_ms?: number;
  full_sync_ms?: number;
  retry_after_failure_ms?: number;
  // How long a waiting call is held before it answers that nothing changed.
  wait_ms?: number;
  pairing_code_ms?: number;
  // How far apart two devices' clocks may be before their calls are refused as stale.
  clock_skew_ms?: number;
}

// A call as the listening side hands it over, from any transport.
export interface PeerRequest {
  device: string;
  // The caller's public key, sent only while pairing.
  key?: string;
  body: Uint8Array;
}

export interface PeerReply {
  status: number;
  body: Uint8Array | string;
}

export type SyncPeer = ReturnType<typeof create_sync_peer>;

// The device could not be reached at any of its addresses.
export class PeerOffline extends Error {}

// The device answered, but refused the call.
export class PeerRefused extends Error {}

// A call this device refuses, answered in plain words.
class CallRefused extends Error {}

interface Link {
  state: PeerState;
  last_synced_at: string;
  error: string;
  last_failure_at: number;
  running: Promise<void> | null;
  waiting: AbortController | null;
  // Files known to be on both devices, so each round only looks at new ones.
  settled_files: Set<string>;
}

const call_timeout_ms = 30_000;
const file_timeout_ms = 300_000;
const wait_poll_ms = 500;
const longest_wait_ms = 30_000;
const files_in_flight = 4;

// fetch reports every network problem as "fetch failed", so the reason underneath is shown with it.
function describe_failure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return cause ? `${error.message}: ${cause}` : error.message;
}

// A trailing slash keeps a device's own folder when the call's path is resolved against its address.
export function normalise_address(address: string): string {
  const url = new URL(address.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("a device's address must start with http:// or https://");
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

// ── Peer ─────────────────────────────────────────────────────────────────────

export function create_sync_peer(options: SyncPeerOptions) {
  const { engine, storage } = options;
  const local_check_ms = options.local_check_ms ?? 2000;
  const full_sync_ms = options.full_sync_ms ?? 60_000;
  const retry_after_failure_ms = options.retry_after_failure_ms ?? 30_000;
  const wait_ms = Math.min(options.wait_ms ?? 25_000, longest_wait_ms);
  const pairing_code_ms = options.pairing_code_ms ?? 10 * 60_000;
  const clock_skew_ms = options.clock_skew_ms ?? 10 * 60_000;
  const do_fetch = (input: URL, init?: RequestInit) => (options.fetch ?? fetch)(input, init);
  const addresses = () => (options.addresses?.() ?? []).map(normalise_address);

  const identity: PeerIdentity = storage.read_identity() ?? create_identity();
  if (storage.read_identity() === null) storage.write_identity(identity);
  const me = identity.device;

  let roster = storage.read_peers();
  const links = new Map<string, Link>();
  // Addresses found on the local network, tried before the ones the group passed on.
  const found_addresses = new Map<string, string>();
  // Codes this device handed out, by secret, until they are used or run out.
  const pairing_secrets = new Map<string, number>();
  // Nonces of calls already answered, until they would be refused as stale anyway.
  const seen_nonces = new Map<string, number>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let running = false;

  function database(): SqlDatabase {
    const opened = options.database();
    engine.claim_for_device(opened, me);
    return opened;
  }

  // ── Group ────────────────────────────────────────────────────────────────

  function save_roster(peers: PeerRecord[]): void {
    roster = peers;
    storage.write_peers(peers);
  }

  // This device's own entry, newer whenever its name or addresses changed, so the change reaches the group.
  function my_record(): PeerRecord {
    const saved = roster.find((peer) => peer.device === me);
    const current = { name: options.device_name, addresses: addresses() };
    if (saved && saved.name === current.name && JSON.stringify(saved.addresses) === JSON.stringify(current.addresses)) return saved;
    const record: PeerRecord = { device: me, public_key: identity.public_key, ...current, updated_at: Math.max(Date.now(), (saved?.updated_at ?? 0) + 1), removed: false };
    save_roster([...roster.filter((peer) => peer.device !== me), record]);
    return record;
  }

  function group(): PeerRecord[] {
    my_record();
    return roster;
  }

  function active_peers(): PeerRecord[] {
    return roster.filter((peer) => peer.device !== me && !peer.removed);
  }

  function find_peer(device: string): PeerRecord | undefined {
    return active_peers().find((peer) => peer.device === device);
  }

  // Takes each entry newer than this device's copy of it, but never one about this device, which only it may change.
  function merge_roster(incoming: unknown): void {
    if (!Array.isArray(incoming)) return;
    const peers = new Map(roster.map((peer) => [peer.device, peer]));
    let changed = false;
    for (const record of incoming as PeerRecord[]) {
      if (typeof record?.device !== "string" || typeof record.public_key !== "string" || record.device === me) continue;
      if (device_id_of(record.public_key) !== record.device) continue;
      const current = peers.get(record.device);
      if (current && current.updated_at >= record.updated_at) continue;
      peers.set(record.device, { ...record, addresses: Array.isArray(record.addresses) ? record.addresses.filter((address) => typeof address === "string") : [] });
      changed = true;
    }
    if (!changed) return;
    save_roster([...peers.values()]);
    refresh_links();
  }

  // A device paired now wins over an older removal of it, and is not made to match a restore made before it joined.
  function add_paired(record: PeerRecord): void {
    const added = { ...record, updated_at: Math.max(Date.now(), record.updated_at + 1), removed: false };
    save_roster([...roster.filter((peer) => peer.device !== record.device), added]);
    const opened = database();
    engine.write_peer(opened, record.device, { claimed: engine.read_state(opened).claim_generation });
    refresh_links();
  }

  // ── Status ───────────────────────────────────────────────────────────────

  function link_of(device: string): Link {
    let link = links.get(device);
    if (!link) {
      link = { state: "offline", last_synced_at: "", error: "", last_failure_at: 0, running: null, waiting: null, settled_files: new Set() };
      links.set(device, link);
    }
    return link;
  }

  function get_status(): SyncStatus {
    const peers: PeerStatus[] = active_peers().map((peer) => {
      const link = link_of(peer.device);
      return { device: peer.device, name: peer.name, addresses: peer.addresses, state: link.state, last_synced_at: link.last_synced_at, error: link.error };
    });
    const states = new Set(peers.map((peer) => peer.state));
    const state = peers.length === 0 ? "off" : states.has("syncing") ? "syncing" : states.has("idle") ? "idle" : states.has("failed") ? "failed" : "offline";
    const last_synced_at = peers.map((peer) => peer.last_synced_at).sort().at(-1) ?? "";
    const error = state === "idle" || state === "syncing" ? "" : (peers.find((peer) => peer.error)?.error ?? "");
    const pending_changes = engine.count_unsent_rows(database(), peers.map((peer) => peer.device));
    return { state, device: me, name: options.device_name, addresses: addresses(), peers, last_synced_at, pending_changes, error };
  }

  function set_link(device: string, changes: Partial<Link>): void {
    Object.assign(link_of(device), changes);
    options.on_status?.(get_status());
  }

  function record_failure(device: string, error: unknown): void {
    set_link(device, { state: error instanceof PeerOffline ? "offline" : "failed", error: describe_failure(error), last_failure_at: Date.now() });
  }

  // ── Calling another device ───────────────────────────────────────────────

  function addresses_of(peer: PeerRecord): string[] {
    const found = found_addresses.get(peer.device);
    return [...new Set([...(found ? [found] : []), ...peer.addresses])];
  }

  // Tries each of the device's addresses in turn; the answer must be sealed by that device for this call.
  async function call<Name extends PeerCallName>(
    peer: PeerRecord,
    name: Name,
    args: PeerCalls[Name]["args"],
    extra: { bytes?: Uint8Array; pairing?: boolean; timeout_ms?: number; signal?: AbortSignal } = {},
  ): Promise<{ result: PeerCalls[Name]["result"]; bytes: Uint8Array }> {
    const body: PeerCallBody = { to: peer.device, at: Date.now(), call: name, args };
    const sealed = seal(body, extra.bytes, peer.public_key, identity.secret_key);
    const headers: Record<string, string> = { "content-type": "application/octet-stream", [peer_device_header]: me };
    if (extra.pairing) headers[peer_key_header] = identity.public_key;

    const tried = addresses_of(peer);
    if (tried.length === 0) throw new PeerOffline(`${peer.name} cannot be reached; it reaches this device instead`);
    let failure: unknown = null;
    for (const address of tried) {
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(extra.timeout_ms ?? call_timeout_ms);
        response = await do_fetch(new URL(sync_peer_path, normalise_address(address)), {
          method: "POST",
          headers,
          body: sealed.body as Uint8Array<ArrayBuffer>,
          signal: extra.signal ? AbortSignal.any([timeout, extra.signal]) : timeout,
        });
      } catch (error) {
        failure = error;
        continue;
      }
      if (!response.ok) throw new PeerRefused(`${peer.name} answered ${response.status}: ${await response.text()}`);
      const opened = open_sealed(new Uint8Array(await response.arrayBuffer()), peer.public_key, identity.secret_key);
      const answer = opened?.json as PeerAnswerBody | undefined;
      if (!opened || answer?.reply_to !== sealed.nonce) throw new PeerRefused(`the answer from ${address} was not sealed by ${peer.name}`);
      if (answer.error !== undefined) throw new PeerRefused(`${peer.name} refused: ${answer.error}`);
      return { result: answer.result as PeerCalls[Name]["result"], bytes: opened.bytes };
    }
    throw new PeerOffline(`${peer.name} cannot be reached: ${describe_failure(failure)}`);
  }

  // ── Exchanging ───────────────────────────────────────────────────────────

  async function exchange_with(peer: PeerRecord): Promise<void> {
    set_link(peer.device, { state: "syncing" });
    const opened = database();

    // After a restore the device's data is made to match this copy's once, removing what the restore took back.
    let replaces = false;
    if (engine.needs_claim(opened, peer.device)) {
      const { result: snapshot } = await call(peer, "snapshot", {});
      engine.claim_everything(opened, snapshot.changes);
      replaces = true;
    }

    const state = engine.read_state(opened);
    const known = engine.read_peer(opened, peer.device);
    const outgoing = engine.collect_changes_since(opened, known.sent_seq, known.site);
    const request: PeerExchangeRequest = {
      site: state.site,
      generation: state.generation,
      cursor: { generation: known.generation, seq: known.received_seq },
      changes: outgoing.changes,
      up_to_seq: outgoing.up_to_seq,
      replaces,
      peers: group(),
    };
    const { result } = await call(peer, "exchange", request);
    if (!is_change_list(result.changes)) throw new PeerRefused(`${peer.name} sent changes this device cannot read`);

    const applied = engine.apply_changes(opened, result.changes);
    // A device whose counter started again, as after its own restore, gets every change once more.
    const restarted = known.generation !== "" && known.generation !== result.generation;
    engine.write_peer(opened, peer.device, {
      site: result.site,
      generation: result.generation,
      received_seq: result.up_to_seq,
      sent_seq: restarted ? 0 : outgoing.up_to_seq,
      ...(replaces ? { claimed: state.claim_generation } : {}),
    });
    merge_roster(result.peers);
    if (applied > 0) options.on_remote_change?.();
    if (await move_files(peer)) options.on_remote_change?.();
    set_link(peer.device, { state: "idle", last_synced_at: new Date().toISOString(), error: "" });
    if (restarted) sync_soon(peer.device);
  }

  // One exchange with the device at a time; a call made while one runs waits for it.
  function sync_with(device: string): Promise<void> {
    const peer = find_peer(device);
    if (!peer) return Promise.resolve();
    const link = link_of(device);
    link.running ??= exchange_with(peer)
      .catch((error: unknown) => record_failure(device, error))
      .finally(() => {
        link.running = null;
      });
    return link.running;
  }

  async function sync_now(): Promise<SyncStatus> {
    await Promise.all(active_peers().filter((peer) => addresses_of(peer).length > 0).map((peer) => sync_with(peer.device)));
    return get_status();
  }

  // Local changes go out within seconds, but a device that could not be reached waits a while before it is tried again.
  function sync_soon(device: string): void {
    const peer = find_peer(device);
    if (!peer || addresses_of(peer).length === 0 || Date.now() - link_of(device).last_failure_at < retry_after_failure_ms) return;
    void sync_with(device);
  }

  // ── Files ────────────────────────────────────────────────────────────────

  async function each_few<Item>(items: Item[], work: (item: Item) => Promise<void>): Promise<void> {
    const queue = [...items];
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    };
    await Promise.all(Array.from({ length: files_in_flight }, worker));
  }

  // Sends the device the named files it lacks and fetches those this device lacks; true when any arrived here.
  // A file neither has yet is tried again next round, once the device that made it has passed it on.
  async function move_files(peer: PeerRecord): Promise<boolean> {
    const files = options.files;
    if (!files) return false;
    const settled = link_of(peer.device).settled_files;
    const names = [...new Set(files.referenced(database()))].filter((name) => is_file_name(name) && !settled.has(name));
    if (names.length === 0) return false;

    const here: string[] = [];
    const absent: string[] = [];
    for (const name of names) ((await files.store.has(name)) ? here : absent).push(name);

    if (here.length > 0) {
      const { result } = await call(peer, "files_missing", { names: here });
      await each_few(result.missing.filter((name) => here.includes(name)), async (name) => {
        const bytes = await files.store.read(name);
        if (bytes) await call(peer, "file_put", { name }, { bytes, timeout_ms: file_timeout_ms });
      });
      for (const name of here) settled.add(name);
    }

    let arrived = false;
    await each_few(absent, async (name) => {
      const { result, bytes } = await call(peer, "file_get", { name }, { timeout_ms: file_timeout_ms });
      if (!result.found || (await hash_bytes(bytes)) !== name) return;
      await files.store.write(name, bytes);
      settled.add(name);
      arrived = true;
    });
    return arrived;
  }

  // ── Pairing ──────────────────────────────────────────────────────────────

  function create_pairing_code(): PairingCode {
    const reachable = addresses();
    if (reachable.length === 0) throw new Error("Other devices cannot reach this one, so it cannot make a pairing code; enter a code made on a device they can reach.");
    const secret = random_secret();
    const expires_at = Date.now() + pairing_code_ms;
    pairing_secrets.set(secret, expires_at);
    const code = encode_pairing_offer({ app: options.app, device: me, public_key: identity.public_key, name: options.device_name, addresses: reachable, secret });
    return { code, expires_at: new Date(expires_at).toISOString() };
  }

  async function pair_device(code: string): Promise<SyncStatus> {
    const offer = decode_pairing_offer(code);
    if (offer.app !== options.app) throw new Error(`that pairing code is for ${offer.app}, not this app`);
    if (offer.device === me) throw new Error("that pairing code was made on this device; enter it on the other one");
    const peer: PeerRecord = { device: offer.device, public_key: offer.public_key, name: offer.name, addresses: offer.addresses, updated_at: 0, removed: false };

    const { result } = await call(peer, "pair", { secret: offer.secret, me: my_record() }, { pairing: true });
    if (result.me?.device !== offer.device || result.me.public_key !== offer.public_key) throw new Error(`${offer.name} answered as another device`);
    add_paired(result.me);
    merge_roster(result.peers);
    await sync_with(offer.device);
    return get_status();
  }

  // The removal reaches the rest of the group with the next exchange, and the device is refused from then on.
  function remove_device(device: string): SyncStatus {
    const record = roster.find((peer) => peer.device === device);
    if (record && device !== me) {
      save_roster([...roster.filter((peer) => peer.device !== device), { ...record, addresses: [], updated_at: Math.max(Date.now(), record.updated_at + 1), removed: true }]);
      engine.remove_peer(database(), device);
      refresh_links();
    }
    return get_status();
  }

  // Remembers a device's address on the local network, such as one found by discovery, and syncs with it soon.
  function found_address(device: string, address: string): void {
    if (!find_peer(device) || found_addresses.get(device) === address) return;
    found_addresses.set(device, normalise_address(address));
    refresh_links();
    sync_soon(device);
  }

  // ── Answering another device ─────────────────────────────────────────────

  type Handler = (args: never, from: { device: string; key: string }, bytes: Uint8Array) => Promise<{ result: unknown; bytes?: Uint8Array }>;

  const handlers: Record<PeerCallName, Handler> = {
    pair: async (args: PeerCalls["pair"]["args"], from) => {
      const expires_at = typeof args.secret === "string" ? pairing_secrets.get(args.secret) : undefined;
      if (expires_at === undefined || expires_at < Date.now()) throw new CallRefused("the pairing code was used already or ran out; make a new one");
      pairing_secrets.delete(args.secret);
      if (args.me?.device !== from.device || args.me.public_key !== from.key) throw new CallRefused("the device pairing is not the one that sealed the call");
      const others = group().filter((peer) => peer.device !== from.device);
      add_paired({ ...args.me, name: String(args.me.name), addresses: Array.isArray(args.me.addresses) ? args.me.addresses : [] });
      return { result: { me: my_record(), peers: others } };
    },

    exchange: async (args: PeerExchangeRequest, from) => {
      if (!is_change_list(args.changes) || typeof args.site !== "string" || typeof args.generation !== "string" || typeof args.up_to_seq !== "number") {
        throw new CallRefused("send site, generation, cursor and a list of changes");
      }
      if (args.replaces) await storage.back_up_before_replace();
      const opened = database();
      const applied = engine.apply_changes(opened, args.changes);
      const state = engine.read_state(opened);
      const since = args.cursor?.generation === state.generation ? Number(args.cursor.seq) || 0 : 0;
      const outgoing = engine.collect_changes_since(opened, since, args.site);
      engine.write_peer(opened, from.device, { site: args.site, generation: args.generation, received_seq: args.up_to_seq, sent_seq: outgoing.up_to_seq });
      merge_roster(args.peers);
      if (applied > 0) options.on_remote_change?.();
      set_link(from.device, { state: "idle", last_synced_at: new Date().toISOString(), error: "" });
      return { result: { site: state.site, generation: state.generation, changes: outgoing.changes, up_to_seq: outgoing.up_to_seq, peers: group() } };
    },

    snapshot: async () => {
      const opened = database();
      const state = engine.read_state(opened);
      const snapshot = engine.collect_snapshot(opened);
      return { result: { site: state.site, generation: state.generation, changes: snapshot.changes, up_to_seq: snapshot.up_to_seq } };
    },

    wait: async (args: PeerCalls["wait"]["args"]) => {
      const until = Date.now() + Math.min(Number(args.wait_ms) || 0, longest_wait_ms);
      for (;;) {
        const state = engine.read_state(database());
        if (args.cursor?.generation !== state.generation || state.last_seq > Number(args.cursor.seq)) return { result: { changed: true } };
        if (Date.now() >= until) return { result: { changed: false } };
        await sleep(wait_poll_ms);
      }
    },

    files_missing: async (args: PeerCalls["files_missing"]["args"]) => {
      const store = options.files?.store;
      if (!store || !Array.isArray(args.names) || !args.names.every(is_file_name)) throw new CallRefused("send the names of files as sha256 hex");
      const missing: string[] = [];
      for (const name of args.names) if (!(await store.has(name))) missing.push(name);
      return { result: { missing } };
    },

    file_get: async (args: PeerCalls["file_get"]["args"]) => {
      const store = options.files?.store;
      if (!store || !is_file_name(args.name)) throw new CallRefused("a file's name is the sha256 of its bytes");
      const bytes = await store.read(args.name);
      return bytes ? { result: { found: true }, bytes } : { result: { found: false } };
    },

    file_put: async (args: PeerCalls["file_put"]["args"], _from, bytes) => {
      const store = options.files?.store;
      if (!store || !is_file_name(args.name)) throw new CallRefused("a file's name is the sha256 of its bytes");
      if ((await hash_bytes(bytes)) !== args.name) throw new CallRefused("the bytes do not match the name");
      if (!(await store.has(args.name))) await store.write(args.name, bytes);
      return { result: { kept: true } };
    },
  };

  function forget_old_nonces(now: number): void {
    for (const [nonce, expires_at] of seen_nonces) if (expires_at < now) seen_nonces.delete(nonce);
  }

  // Only a paired device's call is answered, or a pairing call from a device that sends its key; anything else is refused unopened.
  async function answer(request: PeerRequest): Promise<PeerReply> {
    const peer = find_peer(request.device);
    const key = peer?.public_key ?? request.key;
    if (!key || device_id_of(key) !== request.device) return { status: 403, body: "this device is not paired with that one" };

    const opened = open_sealed(request.body, key, identity.secret_key);
    const call_body = opened?.json as PeerCallBody | undefined;
    if (!opened || !call_body || !(call_body.call in handlers)) return { status: 400, body: "the call was not sealed for this device" };
    const now = Date.now();
    if (call_body.to !== me || Math.abs(now - Number(call_body.at)) > clock_skew_ms) return { status: 400, body: "the call was meant for another device or another time; check both devices' clocks" };
    forget_old_nonces(now);
    if (seen_nonces.has(opened.nonce)) return { status: 400, body: "the call was already answered" };
    seen_nonces.set(opened.nonce, now + 2 * clock_skew_ms);
    if (!peer && call_body.call !== "pair") return { status: 403, body: "this device is not paired with that one" };

    let reply: PeerAnswerBody;
    let bytes: Uint8Array | undefined;
    try {
      const handled = await handlers[call_body.call](call_body.args as never, { device: request.device, key }, opened.bytes);
      reply = { reply_to: opened.nonce, result: handled.result };
      bytes = handled.bytes;
    } catch (error) {
      if (!(error instanceof CallRefused)) throw error;
      reply = { reply_to: opened.nonce, error: error.message };
    }
    return { status: 200, body: seal(reply, bytes, key, identity.secret_key).body };
  }

  // ── Background ───────────────────────────────────────────────────────────

  // Holds a waiting call open on the device, so its changes come over as soon as it has them.
  async function keep_waiting_on(device: string, waiting: AbortController): Promise<void> {
    while (!waiting.signal.aborted) {
      const peer = find_peer(device);
      if (!peer || addresses_of(peer).length === 0) return;
      try {
        const known = engine.read_peer(database(), device);
        const cursor = { generation: known.generation, seq: known.received_seq };
        const { result } = await call(peer, "wait", { cursor, wait_ms }, { timeout_ms: wait_ms + call_timeout_ms, signal: waiting.signal });
        if (result.changed) await sync_with(device);
      } catch (error) {
        if (waiting.signal.aborted) return;
        record_failure(device, error);
        await sleep(retry_after_failure_ms, waiting.signal);
      }
    }
  }

  // Starts waiting on each paired device that can be reached, and stops for removed ones.
  function refresh_links(): void {
    if (!running) return;
    const reachable = new Set(active_peers().filter((peer) => addresses_of(peer).length > 0).map((peer) => peer.device));
    for (const [device, link] of links) {
      if (!reachable.has(device) && link.waiting) {
        link.waiting.abort();
        link.waiting = null;
      }
    }
    for (const device of reachable) {
      const link = link_of(device);
      if (link.waiting) continue;
      link.waiting = new AbortController();
      void keep_waiting_on(device, link.waiting);
    }
    options.on_status?.(get_status());
  }

  function check_local_changes(): void {
    const opened = database();
    for (const peer of active_peers()) if (engine.has_unsent_changes(opened, peer.device)) sync_soon(peer.device);
  }

  // Starts syncing with every paired device and brings in what changed while the app was closed.
  function start(): void {
    if (running) return;
    running = true;
    my_record();
    timers.push(setInterval(check_local_changes, local_check_ms), setInterval(() => void sync_now(), full_sync_ms));
    refresh_links();
    void sync_now();
  }

  function stop(): void {
    running = false;
    for (const timer of timers) clearInterval(timer);
    timers = [];
    for (const link of links.values()) {
      link.waiting?.abort();
      link.waiting = null;
    }
  }

  return { device: me, start, stop, sync_now, get_status, create_pairing_code, pair_device, remove_device, found_address, answer };
}

// The calls a device answers for its page, under the names every app's bridge uses.
export function sync_device_methods(peer: SyncPeer): SyncDeviceMethods {
  return {
    get_sync_status: peer.get_status,
    create_pairing_code: peer.create_pairing_code,
    pair_device: peer.pair_device,
    remove_device: peer.remove_device,
    sync_now: peer.sync_now,
  };
}
