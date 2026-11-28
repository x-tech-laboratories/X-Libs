// An app's own work beside its calls, which the web server and the desktop daemon both run: background jobs, an
// index kept in a file of its own, collectors reading other apps, an assistant. The host hands the services what it
// has, starts them once the database is open, tells them around a restore, and stops them before sync and the
// database close.

// ── Imports ──────────────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";

import type { App } from "./define.ts";

// ── Context ──────────────────────────────────────────────────────────────────

export interface HostContext {
  // Which host runs them: the web server, or the desktop app's daemon.
  kind: "server" | "desktop";
  // The open connection, which a restore replaces, so it is asked for each time.
  database: () => DatabaseSync;
  // The folder the host keeps its own files in, beside the database.
  profile: string;
  // This host in words, such as "X-Notes server on heimdall".
  device_name: string;
  // The server's config file as it was read, for the app's own keys; empty on the desktop.
  config: Readonly<Record<string, unknown>>;
  // Each subfolder a plugin: the config's plugins_folder on the server, the profile's plugins folder on the desktop.
  plugins_folder: string | null;
  // The file this computer's configuration declares the app's settings in, such as /etc/x-notes/declared.json.
  declared_file: string;
  // Tells every page the data changed, but the one whose client id is given.
  announce: (client_id?: string) => void;
  // Sends every page a named event with its data, such as a reply as it is written.
  emit: (event: string, data: unknown) => void;
  // A database file of the app's own beside the main one, such as an index: never backed up, closed on stop.
  side_database: (name: string) => DatabaseSync;
  // A backup of the main database made now, such as before the services change much of it.
  back_up: () => Promise<void>;
}

export interface HostServices {
  // Just before a restore replaces the database, and just after it reopens on the restored copy.
  before_restore?: () => void;
  after_restore?: () => void;
  stop: () => void | Promise<void>;
}

export type StartServices = (context: HostContext) => HostServices | Promise<HostServices>;

// ── Files ────────────────────────────────────────────────────────────────────

// The declarations file a host reads: <PREFIX>_DECLARED_FILE when it is set, even empty for none, else the NixOS
// module's /etc/<id>/declared.json.
export function declared_file_of(app: Pick<App, "id" | "env_prefix">, env: NodeJS.ProcessEnv): string {
  return env[`${app.env_prefix}_DECLARED_FILE`] ?? `/etc/${app.id}/declared.json`;
}

export interface SideDatabases {
  open: (name: string) => DatabaseSync;
  close_all: () => void;
}

// The side databases beside the main file, named after it, such as notes-index.db beside notes.db; each opens once.
export function side_databases(database_path: string): SideDatabases {
  const opened = new Map<string, DatabaseSync>();
  const base = database_path.replace(/\.db$/, "");
  return {
    open: (name) => {
      if (!/^[a-z0-9_-]+$/.test(name)) throw new Error(`A side database's name is letters, digits, - and _, not '${name}'.`);
      let database = opened.get(name);
      if (!database) {
        database = new DatabaseSync(`${base}-${name}.db`);
        database.exec("PRAGMA journal_mode = WAL");
        opened.set(name, database);
      }
      return database;
    },
    close_all: () => {
      for (const database of opened.values()) database.close();
      opened.clear();
    },
  };
}

// The services when the app has none.
export const no_services: HostServices = { stop: () => undefined };
