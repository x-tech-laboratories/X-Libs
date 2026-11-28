// The base app's web server: the page, every data call the page makes, the calls described for other programs over
// OpenAPI and MCP, the server's backups and its own sync peer, all on one database. run_server starts it from the
// app's config, as `npm start` and the NixOS module run it.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import fastify, { type FastifyInstance } from "fastify";

import { openapi_document, positional_args } from "../api_spec.ts";
import { keep_backing_up, type BackupMethods } from "../backups.ts";
import { calls_under, register_accounts } from "../server/account_sign_in.ts";
import { caller_of } from "../caller.ts";
import { AccountStore, holds_accounts, move_accounts } from "../server/account_store.ts";
import { register_call_table } from "../server/call_table.ts";
import { read_server_config } from "../server/config.ts";
import { EventStream } from "../server/events.ts";
import { register_mcp_route } from "../server/mcp.ts";
import { load_accounts } from "../server/passwords.ts";
import { BAD_JSON, register_error_replies, register_lenient_json_body, send_text } from "../server/replies.ts";
import { sqlite_backups } from "../server/sqlite_backups.ts";
import { register_sync_peer_routes } from "../server/sync_peer_routes.ts";
import { register_web_folder } from "../server/web_folder.ts";
import type { SqlDatabase } from "../sql.ts";
import { file_sync_storage } from "../sync_file_storage.ts";
import { create_sync_peer, sync_device_methods, type SyncPeer } from "../sync_peer.ts";
import type { App } from "./define.ts";

// ── Database ─────────────────────────────────────────────────────────────────

export interface AppDatabase {
  // The open connection, which a restore replaces.
  database: () => DatabaseSync;
  // A backup made by hand, such as before a device's data replaces this one.
  back_up: () => Promise<void>;
  backup_methods: BackupMethods;
  close: () => void;
}

// The app's database as the server and the desktop daemon keep it: a file opened and brought up to date, backed up
// before its schema is upgraded, before another copy replaces it, and daily, and restored from a backup.
export function open_app_database(app: App, path: string, backups_folder: string): AppDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const existed = existsSync(path);
  let database = new DatabaseSync(path);

  const kept = sqlite_backups({
    folder: () => (mkdirSync(backups_folder, { recursive: true }), backups_folder),
    naming: app.backup_naming,
    database: () => database,
    database_path: () => path,
    close: () => database.close(),
    open: () => {
      database = new DatabaseSync(path);
      start(database);
    },
    // The restored data no longer matches other devices', so sync asks again which copy wins.
    after_restore: (restored) => app.sync_engine.forget_history(restored),
  });

  // An upgrade is backed up first, since it cannot be undone any other way.
  function start(connection: DatabaseSync): void {
    connection.exec("PRAGMA journal_mode = WAL");
    if (existed && app.needs_upgrade(connection)) connection.prepare("VACUUM INTO ?").run(join(backups_folder, app.backup_naming.name_for(new Date(), false)));
    app.open_store(connection);
  }
  mkdirSync(backups_folder, { recursive: true });
  start(database);

  const keeper = keep_backing_up(kept, () => app.read_backup_schedule(database));

  return {
    database: () => database,
    back_up: async () => void (await kept.create()),
    backup_methods: app.backup_methods(kept, () => database, () => void keeper.check()),
    close: () => {
      keeper.stop();
      database.close();
    },
  };
}

// ── Calls ────────────────────────────────────────────────────────────────────

// An import arrives as one call's argument.
export const call_body_limit = 32 * 1024 * 1024;

// Turns a body into the call's arguments: a JSON list in order, or a JSON object by name.
export function call_args(app: App, method: string, body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const spec = (app.api_spec as Record<string, Parameters<typeof positional_args>[0] | undefined>)[method];
  if (spec && typeof body === "object" && body !== null) return positional_args(spec, body as Record<string, unknown>);
  throw new Error("send the arguments as a JSON list or object");
}

// The page's data calls as routes, the same on the web server and on the desktop app's daemon: POST /call/<method>
// with the arguments as a JSON list, or by name as a JSON object. A change reaches every page and window but the one
// that made it, which already shows it.
export function register_app_calls(api: FastifyInstance, app: App, database: () => SqlDatabase, changes: EventStream): void {
  api.post<{ Params: { method: string } }>("/call/:method", { bodyLimit: call_body_limit }, async (request, reply) => {
    let args: unknown[];
    try {
      args = call_args(app, request.params.method, request.body ?? []);
    } catch (error) {
      return send_text(reply, 400, (error as Error).message);
    }
    const methods = app.bind_methods(database, () => changes.announce_change(changes.client_id_of(request)), caller_of(request));
    const result = await app.bridges.calls.dispatch(methods, request.params.method, args);
    if (result === undefined) return reply.code(204).send();
    // Always JSON, since Fastify sends a bare string such as a new id as plain text the page cannot parse.
    reply.type("application/json");
    if (app.is_read_only(request.params.method)) reply.header("cache-control", "no-store");
    return reply.send(JSON.stringify(result));
  });
}

// ── Server ───────────────────────────────────────────────────────────────────

export interface ServerOptions {
  // The open connection, which a restore replaces.
  database: () => SqlDatabase;
  // Who may sign in: browsers with a session, and desktop apps working on this server with a token of their own.
  accounts: AccountStore;
  web_folder: string;
  // The server's copy as a sync peer, which other devices pair with and send their sealed changes to.
  sync: SyncPeer;
  // Every page's event stream, also told when another device's changes arrived.
  changes: EventStream;
  // The server's own backups, which only an admin reaches.
  backup_methods: BackupMethods;
}

// The server's backups and its sync peer's pairings, which only an admin reaches.
const admin_paths = ["/api/backups/", "/api/sync/"];

// Backup calls only the user at the page may make, since a restored backup could undo what only the user may change.
export const user_only_backup_calls: ReadonlySet<string> = new Set(["restore_backup", "remove_backup", "set_backup_schedule"]);

export async function build_server(app: App, options: ServerOptions): Promise<FastifyInstance> {
  const server = fastify({ forceCloseConnections: true });
  register_lenient_json_body(server);
  register_error_replies(server);
  await register_accounts(server, {
    accounts: options.accounts,
    cookie_name: `${app.id.replaceAll("-", "_")}_session`,
    // Each peer call is sealed between the two devices, so it needs no sign-in.
    open_paths: ["/api/sync/peer"],
    // A read-only token may still list and read through MCP, which posts every request.
    read_only_paths: ["/api/mcp"],
    needed: (_method, path) => (admin_paths.some((admin_path) => path.startsWith(admin_path)) ? { role: options.accounts.top_role } : "any"),
    // A token is refused the calls only the user at the page may make; a read-only one may make the calls that only read.
    call_of: calls_under("/api/call"),
    is_read_only: app.is_read_only,
    page_only: app.page_only,
  });

  const { changes, database } = options;
  const description = { title: app.name, version: app.version, description: app.instructions };

  await server.register(
    async (api) => {
      changes.register(api, "/events");
      register_app_calls(api, app, database, changes);

      api.get("/openapi.json", async () => openapi_document(app.api_spec, { ...description, path_of: (method) => `/api/call/${method}`, is_read_only: app.is_read_only }));

      // A change made through MCP is announced to every page, since no page made it.
      await register_mcp_route(api, {
        name: app.id,
        version: app.version,
        instructions: app.instructions,
        api: app.api_spec,
        is_read_only: app.is_read_only,
        page_only: app.page_only,
        call: (method, args) => app.bridges.calls.dispatch(app.bind_methods(database, () => changes.announce_change(), "program"), method, args),
      });

      // The server's backups, as the page's Settings reach them.
      api.post<{ Params: { method: string } }>("/backups/:method", async (request, reply) => {
        const via = request.viewer?.via;
        if (user_only_backup_calls.has(request.params.method) && via !== "session" && via !== "proxy") return send_text(reply, 403, app.page_only.refusal);
        const args: unknown = request.body ?? [];
        if (args === BAD_JSON || !Array.isArray(args)) return send_text(reply, 400, "send the arguments as a JSON list");
        const result = await app.bridges.backups.dispatch(options.backup_methods, request.params.method, args);
        if (result === undefined) return reply.code(204).send();
        return reply.type("application/json").header("cache-control", "no-store").send(JSON.stringify(result));
      });

      register_sync_peer_routes(api, options.sync);
      register_call_table(api, "/sync", sync_device_methods(options.sync), { is_read_only: app.is_read_only });
    },
    { prefix: "/api" },
  );

  await register_web_folder(server, { folder: options.web_folder });
  return server;
}

// ── Running ──────────────────────────────────────────────────────────────────

// What the config file holds.
interface ServerConfig {
  database: string;
  backups_folder: string;
  // Where other devices reach this server's sync, such as "https://budget.example.org/api/"; none unless set.
  sync_address?: string;
}

export interface RunServerOptions {
  // The built page, such as new URL("../../out/web", import.meta.url) from the app's src/server/main.ts.
  web_folder: URL;
  // The command line and environment, which a test hands in.
  argv?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface RunningServer {
  server: FastifyInstance;
  address: string;
  // Closes the server, then sync, the database and the accounts.
  stop: () => Promise<void>;
}

// Starts the app's web server on the database its config names, and stops it on SIGINT and SIGTERM.
export async function run_server(app: App, options: RunServerOptions): Promise<RunningServer> {
  const prefix = app.env_prefix;
  const server_config = read_server_config({
    program: app.id,
    summary: app.summary,
    env_prefix: prefix,
    default_port: app.ports.server,
    web_folder_default: fileURLToPath(options.web_folder),
    // Accounts sign people in, so no shared token is needed to listen beyond this machine.
    secret: false,
    options: {
      config: { variable: `${prefix}_CONFIG`, help: "the JSON config naming the database and the backups folder", placeholder: "<file>", required: true },
      password_hash_file: { variable: `${prefix}_PASSWORD_HASH_FILE`, help: "the admins' name:hash lines, made with `npm run hash-password -- <name> <file>`", placeholder: "<file>", required: true },
    },
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.env ? { env: options.env } : {}),
  });

  const config = JSON.parse(readFileSync(server_config.values.config!, "utf8")) as ServerConfig;
  const database_path = resolve(config.database);
  const opened = open_app_database(app, database_path, resolve(config.backups_folder));

  // Accounts are a file of their own beside the data, so restoring it never changes who can sign in.
  const accounts_database = new DatabaseSync(join(dirname(database_path), "accounts.db"));
  // An older version kept them in the data's own file; they move out once, after a backup of the file as it was.
  if (holds_accounts(opened.database()) && !holds_accounts(accounts_database)) {
    await opened.back_up();
    move_accounts(opened.database(), accounts_database);
  }
  const accounts = new AccountStore({
    database: accounts_database,
    app_name: app.name,
    ...(app.token_prefix ? { token_prefix: app.token_prefix } : {}),
    declared: load_accounts(`${prefix}_PASSWORD_HASH_FILE`, server_config.values.password_hash_file),
  });

  // Every page hears of a change, whether a page or another device made it.
  const changes = new EventStream();

  // The server is one sync peer among the devices, kept beside the data so a restore leaves its pairings be.
  const sync = create_sync_peer({
    app: app.id,
    engine: app.sync_engine,
    database: opened.database,
    storage: file_sync_storage({ file: join(dirname(database_path), "sync-peers.json"), back_up_before_replace: opened.back_up }),
    device_name: `${app.name} server on ${hostname()}`,
    addresses: () => (config.sync_address ? [config.sync_address] : []),
    on_remote_change: () => changes.announce_change(),
  });

  const server = await build_server(app, { database: opened.database, accounts, web_folder: server_config.web_folder, sync, changes, backup_methods: opened.backup_methods });
  const address = await server.listen({ host: server_config.host, port: server_config.port });
  sync.start();
  console.info(`${app.name} is serving ${address}/`);

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> =>
    (stopping ??= server.close().then(() => {
      sync.stop();
      opened.close();
      accounts_database.close();
    }));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void stop());
  return { server, address, stop };
}
