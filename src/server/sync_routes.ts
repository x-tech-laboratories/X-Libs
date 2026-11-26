// The server's side of sync: it holds the copy every device syncs with, takes each device's changes and hands back
// everyone else's, gives a new device the whole data, and lets a device replace it, starting a new generation. Given a
// file store, it also keeps the files the rows name, such as covers, which devices send and fetch by name. Changes the
// app keeps to the user's own devices, such as settings only the user may change, are refused from a program's token.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { SqlDatabase } from "../sql.ts";
import type { SyncEngine } from "../sync_engine.ts";
import { hash_bytes, is_file_name, type SyncFileStore, type SyncFilesMissingResponse } from "../sync_files.ts";
import { is_change_list, type SyncChange, type SyncExchangeRequest, type SyncExchangeResponse, type SyncReplaceResponse, type SyncSnapshot } from "../sync_protocol.ts";
import { is_user_or_device } from "./viewers.ts";
import { send_text } from "./replies.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface SyncRoutesOptions {
  engine: SyncEngine;
  database: () => SqlDatabase;
  // Saves a copy of the server's data before a device's replaces it.
  back_up?: () => void | Promise<void>;
  // Runs after a device's changes landed, with the request that sent them, such as to announce them to the other pages.
  on_change?: (request: FastifyRequest) => void;
  // Under the plugin's prefix; "/sync" unless set.
  prefix?: string;
  // A device sending its whole database needs room; 256 MiB unless set.
  body_limit?: number;
  // Where the files the rows name are kept; without it the server keeps no files.
  files?: SyncFileStore;
  // The largest file a device may send; 64 MiB unless set.
  file_limit?: number;
  // Changes only the user's own devices may send, such as a setting only the user may change: an exchange holding one
  // from anything else is refused whole, and so is every replace. None unless set.
  device_only?: (change: SyncChange) => boolean;
  // Whether a request came from the user's own device or page; unless set, a session, the trusted proxy or a token the
  // device sign-in made, as `server/account_sign_in` tells them apart (`is_user_or_device`).
  is_device?: (request: FastifyRequest) => boolean;
}

export const device_only_refusal = "Only the user's own devices may sync these changes; a program's token cannot.";

// The viewer `server/account_sign_in` set on the request, if any.
function is_device_by_viewer(request: FastifyRequest): boolean {
  return is_user_or_device((request as { viewer?: Parameters<typeof is_user_or_device>[0] }).viewer);
}

export class GenerationMismatch extends Error {}

// ── Calls ────────────────────────────────────────────────────────────────────

// Takes a device's changes, then gives back everyone else's since its cursor, and whether anything here changed.
export function exchange_changes(engine: SyncEngine, database: SqlDatabase, request: SyncExchangeRequest): [SyncExchangeResponse, boolean] {
  const { generation } = engine.read_state(database);
  if (request.generation !== generation) throw new GenerationMismatch(`the server's data is now generation ${generation}`);
  const applied = engine.apply_changes(database, request.changes);
  const outgoing = engine.collect_changes_since(database, request.cursor, request.site);
  return [{ generation, cursor: outgoing.up_to_seq, changes: outgoing.changes }, applied > 0];
}

export function read_snapshot(engine: SyncEngine, database: SqlDatabase): SyncSnapshot {
  const snapshot = engine.collect_snapshot(database);
  return { generation: engine.read_state(database).generation, cursor: snapshot.up_to_seq, changes: snapshot.changes };
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Wrong JSON answers 400, a device following replaced data 409, so it asks its user which copy to keep.
export function register_sync_routes(app: FastifyInstance, options: SyncRoutesOptions): void {
  const { engine } = options;
  const prefix = options.prefix ?? "/sync";
  const body_limit = options.body_limit ?? 256 * 1024 * 1024;
  const { device_only } = options;
  const is_device = options.is_device ?? is_device_by_viewer;

  app.get(`${prefix}/snapshot`, async () => read_snapshot(engine, options.database()));

  app.post(`${prefix}/exchange`, { bodyLimit: body_limit }, async (request, reply) => {
    const body = request.body as Partial<SyncExchangeRequest> | undefined;
    if (!body || !is_change_list(body.changes) || typeof body.site !== "string" || typeof body.generation !== "string" || typeof body.cursor !== "number") {
      return send_text(reply, 400, "send site, generation, cursor and a list of changes");
    }
    if (device_only && body.changes.some(device_only) && !is_device(request)) return send_text(reply, 403, device_only_refusal);
    try {
      const [answer, has_changed] = exchange_changes(engine, options.database(), body as SyncExchangeRequest);
      if (has_changed) options.on_change?.(request);
      return answer;
    } catch (error) {
      if (error instanceof GenerationMismatch) return send_text(reply, 409, error.message);
      throw error;
    }
  });

  // The server's data is backed up, then swapped for the device's, which starts a new generation every other device must choose against.
  app.post(`${prefix}/replace`, { bodyLimit: body_limit }, async (request, reply) => {
    const body = request.body as { changes?: unknown } | undefined;
    if (!body || !is_change_list(body.changes)) return send_text(reply, 400, "send a list of changes");
    // Replacing drops whatever the device's copy lacks, so any of the protected changes may go with it.
    if (device_only && !is_device(request)) return send_text(reply, 403, device_only_refusal);
    const database = options.database();
    await options.back_up?.();
    engine.replace_with_snapshot(database, body.changes);

    const generation = crypto.randomUUID();
    engine.write_state(database, { generation });
    options.on_change?.(request);
    const answer: SyncReplaceResponse = { generation, cursor: engine.read_state(database).last_seq };
    return answer;
  });

  if (options.files) register_file_routes(app, prefix, options.files, options.file_limit ?? 64 * 1024 * 1024);
}

// A file is fetched and sent by its name, which must be the sha256 of its bytes; the page may show it from the GET route.
function register_file_routes(app: FastifyInstance, prefix: string, files: SyncFileStore, file_limit: number): void {
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: file_limit }, (_request, body, done) => done(null, body));
  }

  app.post(`${prefix}/files/missing`, async (request, reply) => {
    const names = (request.body as { names?: unknown } | undefined)?.names;
    if (!Array.isArray(names) || !names.every(is_file_name)) return send_text(reply, 400, "send the names of files as sha256 hex");
    const missing: string[] = [];
    for (const name of names) if (!(await files.has(name))) missing.push(name);
    const answer: SyncFilesMissingResponse = { missing };
    return answer;
  });

  app.get<{ Params: { name: string } }>(`${prefix}/files/:name`, async (request, reply) => {
    const { name } = request.params;
    if (!is_file_name(name)) return send_text(reply, 400, "a file's name is the sha256 of its bytes");
    const bytes = await files.read(name);
    if (!bytes) return send_text(reply, 404, "no such file");
    // The name is the bytes' hash, so a file never changes and may be kept for good.
    return reply.header("content-type", "application/octet-stream").header("cache-control", "private, max-age=31536000, immutable").send(Buffer.from(bytes));
  });

  app.put<{ Params: { name: string } }>(`${prefix}/files/:name`, { bodyLimit: file_limit }, async (request, reply) => {
    const { name } = request.params;
    if (!is_file_name(name)) return send_text(reply, 400, "a file's name is the sha256 of its bytes");
    if (!Buffer.isBuffer(request.body)) return send_text(reply, 400, "send the file's bytes as application/octet-stream");
    const bytes = new Uint8Array(request.body);
    if ((await hash_bytes(bytes)) !== name) return send_text(reply, 400, "the bytes do not match the name");
    if (!(await files.has(name))) await files.write(name, bytes);
    return reply.code(204).send();
  });
}
