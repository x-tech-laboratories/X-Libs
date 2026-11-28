// The base app's desktop daemon: everything the app does without a window, being the database, sync and backups. The
// window reaches it over a Unix socket with the same calls a browser makes to the web server, and closing the window
// leaves it running. run_daemon starts it as the window does, from the environment.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import fastify from "fastify";

import { create_certificate_trust } from "../certificates.ts";
import { DaemonRunningError, daemon_socket_path, listen_on_socket } from "../local_daemon.ts";
import { register_call_table } from "../server/call_table.ts";
import { EventStream } from "../server/events.ts";
import { register_error_replies, register_lenient_json_body } from "../server/replies.ts";
import { file_sync_storage } from "../sync_file_storage.ts";
import { create_sync_peer, sync_device_methods } from "../sync_peer.ts";
import { keep_listening_for_peers } from "../sync_peer_listening.ts";
import type { App } from "./define.ts";
import { declared_file_of, no_services, side_databases, type HostServices, type StartServices } from "./services.ts";
import { read_desktop_settings, type DaemonMethods, type DesktopSettings } from "./protocol.ts";
import { call_body_limit, open_app_database, register_app_calls } from "./server.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface DaemonOptions {
  database_path: string;
  socket_path: string;
  // Runs once the daemon has stopped, such as to end the process.
  on_stopped: () => void;
  // How long it waits after its last window closed before it stops, when it is not to keep running in the background.
  unused_exit_ms?: number;
  unused_check_ms?: number;
  // The port other devices reach this computer's sync on once it lets them connect; the app's own unless set.
  default_peer_port?: number;
  // The app's own work beside its calls, started once the daemon answers and stopped before sync and the database.
  services?: StartServices;
  // Where the declarations this computer's configuration makes are read from; /etc/<id>/declared.json unless set.
  declared_file?: string;
  // The app's icon, which the desktop app hands in for notifications.
  icon_path?: string | null;
}

export interface Daemon {
  // Stops the app's services, sync, the socket and the database, then runs on_stopped; a second call does nothing.
  shut_down: () => Promise<void>;
}

// ── Daemon ───────────────────────────────────────────────────────────────────

// Answers on the socket and starts sync; null when another daemon on the same database already answers.
export async function start_daemon(app: App, options: DaemonOptions): Promise<Daemon | null> {
  const { database_path, socket_path } = options;
  const profile = dirname(database_path);
  const unused_exit_ms = options.unused_exit_ms ?? 30_000;
  const unused_check_ms = options.unused_check_ms ?? 5000;

  // Backed up before an upgrade, before another copy replaces it, and daily, beside the database.
  const opened = open_app_database(app, database_path, join(profile, "backups"));

  // Every window's event stream, told when the data changed or sync's status moved.
  const changes = new EventStream();

  // Server certificates the user trusted, such as a home server's self-signed one, handed to Node's own fetch.
  const certificates = create_certificate_trust({ file: join(profile, "trusted-certificates.json"), use_in_node: true });

  // Off until "Let other devices connect" is turned on; then other devices reach this computer's sync on its port.
  const listening = keep_listening_for_peers({ peer: () => sync, app: app.id, file: join(profile, "sync-listening.json"), default_port: options.default_peer_port ?? app.ports.peer });

  // This computer is one sync peer among the devices, reaching out to the ones it is paired with.
  const sync = create_sync_peer({
    app: app.id,
    engine: app.sync_engine,
    database: opened.database,
    storage: file_sync_storage({ file: join(profile, "sync-peers.json"), back_up_before_replace: opened.back_up }),
    device_name: `${app.name} on ${hostname()}`,
    addresses: () => listening.addresses(),
    on_remote_change: () => changes.announce_change(),
    on_status: (status) => changes.send(JSON.stringify(status), { event: "sync_status" }),
  });

  // ── Desktop settings ───────────────────────────────────────────────

  const desktop_file = join(profile, "desktop.json");

  function read_desktop(): DesktopSettings {
    return read_desktop_settings(existsSync(desktop_file) ? JSON.parse(readFileSync(desktop_file, "utf8")) : null, app.desktop_settings);
  }

  // Told by the window as it comes and goes.
  let window_in_front = false;

  const daemon_methods: DaemonMethods = {
    get_desktop_settings: read_desktop,
    set_desktop_setting: (key, value) => writeFileSync(desktop_file, JSON.stringify(read_desktop_settings({ ...read_desktop(), [key]: value }, app.desktop_settings), null, 2)),
    // Stops once the answer has gone back.
    stop_daemon: () => void setTimeout(() => void shut_down(), 0),
    set_window_in_front: (in_front) => void (window_in_front = in_front === true),
  };

  // ── Calls ──────────────────────────────────────────────────────────

  const daemon = fastify({ bodyLimit: call_body_limit, forceCloseConnections: true });
  register_lenient_json_body(daemon);
  register_error_replies(daemon);
  // A change from one window reaches the others; the one that made it already shows it.
  const tell_others = (client_id: string): void => changes.announce_change(client_id);
  const is_read_only = app.is_read_only;
  await daemon.register(
    async (api) => {
      changes.register(api, "/events");
      register_app_calls(api, app, opened.database, changes);
      register_call_table(api, "/backups", opened.backup_methods, { is_read_only, on_change: tell_others });
      register_call_table(api, "/device", sync_device_methods(sync), { is_read_only, on_change: tell_others });
      register_call_table(api, "/peer_listening", listening.methods, { is_read_only });
      register_call_table(api, "/certificates", certificates.methods, { is_read_only });
      register_call_table(api, "/daemon", daemon_methods, { is_read_only, on_change: tell_others });
    },
    { prefix: "/api" },
  );

  // ── Lifecycle ──────────────────────────────────────────────────────

  let stopping: Promise<void> | null = null;
  let unused_timer: ReturnType<typeof setInterval> | undefined;
  const sides = side_databases(database_path);
  let services: HostServices = no_services;

  function shut_down(): Promise<void> {
    stopping ??= (async () => {
      clearInterval(unused_timer);
      await services.stop();
      sync.stop();
      await daemon.close();
      await listening.stop();
      sides.close_all();
      opened.close();
      options.on_stopped();
    })();
    return stopping;
  }

  try {
    await listen_on_socket(socket_path, (path) => daemon.listen({ path }));
  } catch (error) {
    await daemon.close();
    opened.close();
    // Another daemon on this database got there first, which is all that was asked for.
    if (error instanceof DaemonRunningError) return null;
    throw error;
  }

  await listening.start();
  sync.start();

  if (options.services) {
    services = await options.services({
      kind: "desktop",
      database: opened.database,
      profile,
      device_name: `${app.name} on ${hostname()}`,
      config: {},
      plugins_folder: join(profile, "plugins"),
      declared_file: options.declared_file ?? `/etc/${app.id}/declared.json`,
      announce: (client_id) => changes.announce_change(client_id),
      emit: (event, data) => changes.send(JSON.stringify(data), { event }),
      side_database: sides.open,
      back_up: opened.back_up,
      window_in_front: () => window_in_front,
      icon_path: options.icon_path ?? null,
    });
    opened.on_restore({ before: () => services.before_restore?.(), after: () => services.after_restore?.() });
  }

  // Without "Keep running in the background", the daemon stops a while after its last window has gone.
  let unused_since = Date.now();
  unused_timer = setInterval(() => {
    if (changes.client_count > 0 || read_desktop().keep_running_in_background) unused_since = Date.now();
    else if (Date.now() - unused_since >= unused_exit_ms) void shut_down();
  }, unused_check_ms);

  return { shut_down };
}

// ── Running ──────────────────────────────────────────────────────────────────

// Starts the daemon on the database and socket the window names in <PREFIX>_DB and <PREFIX>_SOCKET, and ends the
// process once it stops.
export async function run_daemon(app: App, env: NodeJS.ProcessEnv = process.env, extra: { services?: StartServices } = {}): Promise<void> {
  const database_path = env[`${app.env_prefix}_DB`];
  if (!database_path) {
    console.error(`${app.id} daemon: ${app.env_prefix}_DB must name the database`);
    process.exit(2);
  }
  // A run on another database has a socket of its own.
  const socket_path = env[`${app.env_prefix}_SOCKET`] || daemon_socket_path({ app: app.id, data_file: database_path });

  try {
    const daemon = await start_daemon(app, { database_path, socket_path, on_stopped: () => process.exit(0), declared_file: declared_file_of(app, env), icon_path: env[`${app.env_prefix}_ICON`] ?? null, ...extra });
    // Another daemon on this database got there first, which is all that was asked for.
    if (!daemon) process.exit(0);
    console.log(`${app.id} daemon on ${socket_path}, using ${database_path}`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void daemon.shut_down());
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  }
}
