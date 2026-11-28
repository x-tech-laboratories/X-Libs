// An app's settings in one synced table of JSON values by key, each feature declaring its own with their defaults, who
// may write them and how their secrets are hidden; the store gives the calls, their api specs and the settings file
// every app exports and imports. It runs wherever the database is: a server, a desktop daemon or a phone's page.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { ApiSpec } from "./api_spec.ts";
import { hidden_secret } from "./plugins.ts";
import { in_transaction, type MigrationStep, type SqlDatabase } from "./sql.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

export type Settings = Record<string, unknown>;

export interface SettingSpec {
  default?: unknown;
  // Written only by the user at the app's own page, never by a token or an MCP client, and synced only between the user's own devices.
  user_only?: boolean;
  // This device's own, such as its backup schedule: never synced, exported or imported.
  local?: boolean;
  // Another service's key or token: read as hidden_secret while set, kept when that comes back, and left out of an export unless asked for.
  secret?: boolean;
  // What the page and other programs read in place of the stored value, such as its tokens hidden.
  hide?: (value: unknown) => unknown;
  // What is stored when a value comes back, given the value held now, such as a hidden token put back as it was.
  keep?: (stored: unknown, incoming: unknown) => unknown;
}

// The same spec for every key in a table of defaults, such as a feature's settings that are all the user's alone.
export function settings_of(defaults: Settings, spec: Omit<SettingSpec, "default"> = {}): Record<string, SettingSpec> {
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { ...spec, default: value }]));
}

// ── Rows ─────────────────────────────────────────────────────────────────────

// The step every app's settings feature ran first under the owner "settings", so a database made before this module needs no new one.
export const settings_migration = "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

export const settings_owner = "settings";

// One stored setting by key, undefined where it was never set.
export function read_setting(database: SqlDatabase, key: string): unknown {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}

export function write_setting(database: SqlDatabase, key: string, value: unknown): void {
  database.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

// Every stored setting as it is, secrets included.
export function read_stored_settings(database: SqlDatabase): Settings {
  const rows = database.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
}

// ── Secrets ──────────────────────────────────────────────────────────────────

export function hide_secret_text(value: unknown): unknown {
  return typeof value === "string" && value !== "" ? hidden_secret : value;
}

export function keep_secret_text(stored: unknown, incoming: unknown): unknown {
  return incoming === hidden_secret ? stored : incoming;
}

// ── Settings file ────────────────────────────────────────────────────────────

export const settings_file_version = 1;

export interface SettingsFile {
  app: string;
  kind: "settings";
  version: number;
  exported_at: string;
  settings: Settings;
}

export interface SettingsImport {
  changed: number;
  unchanged: number;
}

export interface SettingsApp {
  // Such as "x-control", written into every settings file and checked on import.
  id: string;
  // Such as "X-Control", in the words an import refusal uses.
  name: string;
}

// The settings a file holds, given as an object or its text, refused when another app or a newer version made it.
export function read_settings_file(app: SettingsApp, file: unknown): Settings {
  let parsed = file;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error("That file is not JSON.");
    }
  }
  const envelope = (parsed ?? {}) as Partial<SettingsFile>;
  if (envelope.app !== app.id) throw new Error(`That file was not made by ${app.name}.`);
  if (envelope.kind !== "settings" || !envelope.settings || typeof envelope.settings !== "object" || Array.isArray(envelope.settings)) throw new Error("That file holds no settings.");
  if (typeof envelope.version !== "number" || envelope.version > settings_file_version) throw new Error(`That file was made by a newer ${app.name}; update this one first.`);
  return envelope.settings;
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface SettingsTable {
  name: "settings";
  key_columns: ["key"];
  local_keys?: readonly string[];
}

export interface SettingsMethods {
  // Every setting, the ones never set at their defaults, with each one's secrets hidden.
  get_settings: (database: SqlDatabase) => Settings;
  set_setting: (database: SqlDatabase, key: string, value: unknown) => void;
  export_settings: (database: SqlDatabase, include_secrets?: boolean) => SettingsFile;
  import_settings: (database: SqlDatabase, file: unknown) => SettingsImport;
}

export interface SettingsStoreOptions {
  app: SettingsApp;
  // Keys with no spec of their own that an import still takes, such as "diet.target_protein".
  knows?: (key: string) => boolean;
  // The words of each call for other programs, such as which keys get_settings holds, in place of the plain ones.
  descriptions?: Partial<Record<keyof SettingsMethods, string>>;
  // A key the set_setting call's description gives as an example, such as "history.keep_days".
  key_example?: string;
}

export interface SettingsStore {
  id: typeof settings_owner;
  migrations: readonly MigrationStep[];
  tables: SettingsTable[];
  specs: Readonly<Record<string, SettingSpec>>;
  defaults: Readonly<Settings>;
  user_only: ReadonlySet<string>;
  local_keys: readonly string[];
  // The page_only_calls rule: a write of a user-only setting, an import holding one, or an export with secrets.
  is_user_only_call: (method: string, args: readonly unknown[]) => boolean;
  // The device_only rule for register_sync_routes: a synced row holding a user-only setting.
  is_device_only: (change: { table: string; key: string }) => boolean;
  // One setting as stored, or its default where never set, secrets included.
  value_of: (database: SqlDatabase, key: string) => unknown;
  methods: SettingsMethods;
  api: ApiSpec<SettingsMethods>;
}

function merge_specs(tables: readonly Record<string, SettingSpec>[]): Record<string, SettingSpec> {
  const merged: Record<string, SettingSpec> = {};
  for (const table of tables) {
    for (const [key, spec] of Object.entries(table)) {
      if (Object.hasOwn(merged, key)) throw new Error(`The setting ${key} is declared twice.`);
      merged[key] = spec.secret ? { hide: hide_secret_text, keep: keep_secret_text, ...spec } : spec;
    }
  }
  return merged;
}

// The settings feature of an app from every feature's spec table.
export function create_settings_store(tables: readonly Record<string, SettingSpec>[], options: SettingsStoreOptions): SettingsStore {
  const specs = merge_specs(tables);
  const entries = Object.entries(specs);
  const defaults = Object.fromEntries(entries.filter(([, spec]) => Object.hasOwn(spec, "default")).map(([key, spec]) => [key, spec.default]));
  const user_only: ReadonlySet<string> = new Set(entries.filter(([, spec]) => spec.user_only).map(([key]) => key));
  const local_keys = entries.filter(([, spec]) => spec.local).map(([key]) => key);
  const knows = (key: string) => Object.hasOwn(specs, key) || (options.knows?.(key) ?? false);
  const travels = (key: string) => !specs[key]?.local;

  const value_of = (database: SqlDatabase, key: string) => read_setting(database, key) ?? defaults[key];

  const hidden = (settings: Settings): Settings =>
    Object.fromEntries(Object.entries(settings).map(([key, value]) => {
      const hide = specs[key]?.hide;
      return [key, hide ? hide(value) : value];
    }));

  const kept = (database: SqlDatabase, key: string, value: unknown): unknown => {
    const keep = specs[key]?.keep;
    return keep ? keep(value_of(database, key), value) : value;
  };

  const set_setting = (database: SqlDatabase, key: string, value: unknown): void => write_setting(database, key, kept(database, key, value));

  const export_settings = (database: SqlDatabase, include_secrets = false): SettingsFile => {
    const shared = Object.entries(read_stored_settings(database)).filter(([key]) => travels(key) && (include_secrets || !specs[key]?.secret));
    const settings = Object.fromEntries(shared);
    return { app: options.app.id, kind: "settings", version: settings_file_version, exported_at: new Date().toISOString(), settings: include_secrets ? settings : hidden(settings) };
  };

  // A key the file leaves out keeps its value, and one the app does not know, or of one device, is ignored.
  const import_settings = (database: SqlDatabase, file: unknown): SettingsImport => {
    const taken = Object.entries(read_settings_file(options.app, file)).filter(([key, value]) => key !== "" && value !== undefined && knows(key) && travels(key));
    return in_transaction(database, () => {
      let changed = 0;
      for (const [key, value] of taken) {
        const value_to_store = kept(database, key, value);
        if (JSON.stringify(value_of(database, key)) === JSON.stringify(value_to_store)) continue;
        write_setting(database, key, value_to_store);
        changed += 1;
      }
      return { changed, unchanged: taken.length - changed };
    });
  };

  const holds_user_only = (file: unknown): boolean => {
    try {
      return Object.keys(read_settings_file(options.app, file)).some((key) => user_only.has(key));
    } catch {
      return false;
    }
  };

  const is_user_only_call = (method: string, args: readonly unknown[]): boolean =>
    (method === "set_setting" && user_only.has(String(args[0]))) || (method === "export_settings" && args[0] === true) || (method === "import_settings" && holds_user_only(args[0]));

  const descriptions = options.descriptions ?? {};
  const key_example = options.key_example ? `, such as ${options.key_example}` : "";

  return {
    id: settings_owner,
    migrations: [settings_migration],
    tables: [local_keys.length > 0 ? { name: "settings", key_columns: ["key"], local_keys } : { name: "settings", key_columns: ["key"] }],
    specs,
    defaults,
    user_only,
    local_keys,
    is_user_only_call,
    is_device_only: (change) => change.table === "settings" && user_only.has(change.key),
    value_of,
    methods: {
      get_settings: (database) => hidden({ ...defaults, ...read_stored_settings(database) }),
      set_setting,
      export_settings,
      import_settings,
    },
    api: {
      get_settings: { description: descriptions.get_settings ?? "Every setting by key, the ones never set at their defaults, with keys and tokens for other services hidden.", params: [] },
      set_setting: {
        description: descriptions.set_setting ?? "Sets one setting by key to any JSON value; a hidden key or token sent back keeps the one stored.",
        params: [
          { name: "key", schema: { type: "string", description: `The setting's key${key_example}.` } },
          { name: "value", schema: { description: "The new value." } },
        ],
      },
      export_settings: {
        description:
          descriptions.export_settings ??
          `The settings set, by key, as a settings file import_settings reads back, leaving out those of this device alone. Keys and tokens for other services are left out unless include_secrets is true, which only the user may ask for.`,
        params: [{ name: "include_secrets", schema: { type: "boolean", description: "Whether to include the keys and tokens for other services." }, optional: true }],
      },
      import_settings: {
        description:
          descriptions.import_settings ??
          `Sets every setting a settings file holds, ignoring keys this version does not know and those of one device, and keeping the value of any key it leaves out. Answers how many changed and how many already had the file's value.`,
        params: [{ name: "file", schema: { description: "The settings file, as an object or its text." } }],
        destructive: true,
      },
    },
  };
}
