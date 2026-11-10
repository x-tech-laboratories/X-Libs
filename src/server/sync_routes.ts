// The server's side of sync: it holds the copy every device syncs with, takes each device's changes and hands back
// everyone else's, gives a new device the whole data, and lets a device replace it, starting a new generation.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { SqlDatabase } from "../sql.ts";
import type { SyncEngine } from "../sync_engine.ts";
import { is_change_list, type SyncExchangeRequest, type SyncExchangeResponse, type SyncReplaceResponse, type SyncSnapshot } from "../sync_protocol.ts";
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

  app.get(`${prefix}/snapshot`, async () => read_snapshot(engine, options.database()));

  app.post(`${prefix}/exchange`, { bodyLimit: body_limit }, async (request, reply) => {
    const body = request.body as Partial<SyncExchangeRequest> | undefined;
    if (!body || !is_change_list(body.changes) || typeof body.site !== "string" || typeof body.generation !== "string" || typeof body.cursor !== "number") {
      return send_text(reply, 400, "send site, generation, cursor and a list of changes");
    }
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
    const database = options.database();
    await options.back_up?.();
    engine.replace_with_snapshot(database, body.changes);

    const generation = crypto.randomUUID();
    engine.write_state(database, { generation });
    options.on_change?.(request);
    const answer: SyncReplaceResponse = { generation, cursor: engine.read_state(database).last_seq };
    return answer;
  });
}
