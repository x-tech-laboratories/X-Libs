// The base app's description of one X-app: its name, ports and files, and its features, each bringing tables, calls
// and settings. define_app puts them together into the one database every device keeps, the calls the page makes
// through whichever host it runs on, and the names every host shares, so the server, the daemon, the desktop window and
// the page are all run from the same object.

// ── Imports ──────────────────────────────────────────────────────────────────

import { page_only_calls, type ApiSpec, type PageOnlyCalls } from "../api_spec.ts";
import { backup_naming, default_backup_schedule, type BackupMethods, type Backups, type BackupNaming } from "../backups.ts";
import type { BackupSchedule } from "../backup_protocol.ts";
import { as_caller, type Caller } from "../caller.ts";
import { certificate_method_names, type CertificateMethods } from "../certificate_protocol.ts";
import { connection_method_names, type ConnectionMethods } from "../connection_protocol.ts";
import { define_bridge, type Bridge } from "../electron/bridge.ts";
import { define_events, type EventsBridge } from "../electron/events.ts";
import type { History } from "../history.ts";
import { local_mcp_method_names, type LocalMcpMethods } from "../local_mcp_protocol.ts";
import { create_settings_store, read_setting, settings_of, write_setting, type SettingSpec, type SettingsMethods, type SettingsStore, type SettingsStoreOptions } from "../settings.ts";
import { migrate, type MigrationStep, type SqlDatabase } from "../sql.ts";
import { create_sync_engine, type SyncedTable } from "../sync_engine.ts";
import { backup_method_names } from "../backups.ts";
import { peer_listening_method_names, sync_device_method_names, type PeerListeningMethods, type SyncDeviceMethods, type SyncStatus } from "../sync_protocol.ts";
import { desktop_method_names, type DesktopMethods, type DesktopSettingSpec } from "./protocol.ts";

// ── Features ─────────────────────────────────────────────────────────────────

// A call runs where the database is: on the server, in the desktop app's daemon, or in the phone's page.
export type StoreMethod = (database: SqlDatabase, ...args: never[]) => unknown;

// The parts of a history the store runs, whatever the items are.
export type KeptHistory = Pick<History<unknown>, "synced_table" | "install" | "forget_touched" | "record" | "prune">;

export interface Feature<Methods extends Record<string, StoreMethod> = Record<string, StoreMethod>> {
  id: string;
  // Each step runs once, in order; a released step is never edited, only followed by a new one.
  migrations: readonly MigrationStep[];
  // Parents before children; every table the page writes syncs unless it is only this device's.
  tables: readonly SyncedTable[];
  // Names that read start with list_, get_, search_, lookup_ or export_, so a write is the only call that announces a change.
  methods: Methods;
  // What each call does and takes, for programs that reach them through MCP or the API.
  api: ApiSpec<Methods>;
  // The settings this feature owns, by key such as "budget.rollup_mode".
  settings?: Record<string, SettingSpec>;
  // The versions kept of the feature's items, recorded after every write and synced with them.
  histories?: readonly KeptHistory[];
  // Run each time the database opens, once it is up to date, such as to repair what an older version left.
  on_open?: (database: SqlDatabase) => void;
  // Run after every write, before its history is recorded, so the feature can catch up, such as on derived rows.
  after_write?: (database: SqlDatabase) => void;
}

export function define_feature<Methods extends Record<string, StoreMethod>>(feature: Feature<Methods>): Feature<Methods> {
  return feature;
}

// A call that only reads, so it announces no change and keeps no version.
export function is_read_only(method: string): boolean {
  return /^(list|get|search|lookup|export)_/.test(method);
}

// ── Types ────────────────────────────────────────────────────────────────────

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Both) => void ? Both : never;

type Bound<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends (database: SqlDatabase, ...args: infer Args) => infer Result ? (...args: Args) => Result : never;
};

type StoreMethodsOf<Features extends readonly Feature[]> = UnionToIntersection<Features[number]["methods"]>;

// Every call the page can make, as it makes them, without the database.
export type AppMethods<Features extends readonly Feature[]> = Bound<SettingsMethods & StoreMethodsOf<Features>>;

// ── Definition ───────────────────────────────────────────────────────────────

export interface AppOptions<Features extends readonly Feature[]> {
  // The app's id and name, such as "x-budget" and "X-Budget".
  id: string;
  name: string;
  // Its environment variables' start, such as "X_BUDGET" for X_BUDGET_CONFIG.
  env_prefix: string;
  version: string;
  // One sentence for the server's --help, such as "Serves X-Budget as a web app and syncs its devices."
  summary: string;
  // What other programs reading the calls through MCP are told first.
  instructions: string;
  // The data in plain words, such as "budgets", for "Keep this device's budgets alike with your other devices".
  data_name: string;
  // The database file and the start of each backup's name, such as "budget.db" and "budget".
  database_file: string;
  backup_prefix: string;
  // The web server's port, and the port other devices reach a desktop's sync on once it lets them connect.
  ports: { server: number; peer: number };
  // A server address as an example, such as "https://budget.example.org".
  server_example: string;
  features: Features;
  // Settings the whole app shares, such as the currency, beside the base's own.
  settings?: Record<string, SettingSpec>;
  settings_descriptions?: SettingsStoreOptions["descriptions"];
  setting_key_example?: string;
  // What a token or an MCP client is told when it makes a call only the user at the page may make.
  page_only_refusal?: string;
  // The start of the server's access tokens, such as "cx" for cx_…; "xt" when not given.
  token_prefix?: string;
  // How many days of changes the history keeps until the user chooses; 365 unless set.
  history_days?: number;
  // The desktop app's own switches beside the base's, kept on the computer, such as which notifications it shows.
  desktop_settings?: Readonly<Record<string, DesktopSettingSpec>>;
  // The scheme of the app's links, such as "x-notes" for x-notes://note/<id>, which open the desktop app on that page.
  link_scheme?: string;
  // The desktop app's own MCP endpoint on 127.0.0.1 for AI clients on the same computer, off until turned on in
  // Settings, on its own default port so several apps can run at once.
  local_mcp?: { default_port: number };
}

// The settings every app keeps: how long its history reaches back, and this device's backup schedule.
export const base_setting_defaults = {
  // How many days of changes the history keeps, each item keeping its newest version; 0 keeps them all.
  history_days: 365,
};

export const backup_schedule_key = "backup_schedule";

const base_settings: Record<string, SettingSpec> = {
  ...settings_of(base_setting_defaults),
  // How this device backs up is its own, never synced.
  [backup_schedule_key]: { local: true },
};

export function is_backup_schedule(value: unknown): value is BackupSchedule {
  const schedule = value as BackupSchedule | null;
  return typeof schedule?.automatic === "boolean" && Number.isInteger(schedule.to_keep) && schedule.to_keep >= 0;
}

// What every host's backups can restore, beside listing, making and removing them.
export interface Restorable extends Backups {
  restore: (name: string) => Promise<void>;
}

// The events the desktop app's main process sends its pages: the data changed elsewhere, sync's status moved, or one
// of the app's own events its services emitted, by name.
export type AppEvents = { changed: null; sync_status: SyncStatus; app_event: { event: string; data: unknown } };

export interface AppBridges<Methods extends Record<keyof Methods, (...args: never[]) => unknown>> {
  calls: Bridge<Methods>;
  device: Bridge<SyncDeviceMethods>;
  peer_listening: Bridge<PeerListeningMethods>;
  backups: Bridge<BackupMethods>;
  certificates: Bridge<CertificateMethods>;
  desktop: Bridge<DesktopMethods>;
  connections: Bridge<ConnectionMethods>;
  local_mcp: Bridge<LocalMcpMethods>;
  events: EventsBridge<AppEvents>;
}

export function define_app<const Features extends readonly Feature[]>(options: AppOptions<Features>) {
  type Methods = AppMethods<Features>;

  // ── Settings ─────────────────────────────────────────────────────────

  const own_base_settings = options.history_days === undefined ? base_settings : { ...base_settings, history_days: { ...base_settings.history_days, default: options.history_days } };
  const settings_store: SettingsStore = create_settings_store([own_base_settings, options.settings ?? {}, ...options.features.map((feature) => feature.settings ?? {})], {
    app: { id: options.id, name: options.name },
    ...(options.settings_descriptions ? { descriptions: options.settings_descriptions } : {}),
    ...(options.setting_key_example ? { key_example: options.setting_key_example } : {}),
  });
  const settings_feature: Feature = { id: settings_store.id, migrations: settings_store.migrations, tables: settings_store.tables, methods: { ...settings_store.methods }, api: settings_store.api as ApiSpec<Record<string, StoreMethod>> };
  const features: readonly Feature[] = [settings_feature, ...(options.features as readonly Feature[])];
  const histories = features.flatMap((feature) => feature.histories ?? []);

  // ── Sync ─────────────────────────────────────────────────────────────

  // A history's versions sync like its items; versions are recorded by the device that made a change, never on arrival.
  const sync_engine = create_sync_engine({
    tables: [...features.flatMap((feature) => feature.tables), ...histories.map((history) => history.synced_table)],
    after_apply: (database) => histories.forEach((history) => history.forget_touched(database)),
  });

  // ── Opening ──────────────────────────────────────────────────────────

  // Whether a database already holding data has steps to run, so it can be backed up before its schema is upgraded.
  function needs_upgrade(database: SqlDatabase): boolean {
    const has_versions = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_versions'").get();
    if (!has_versions) return false;
    return features.some((feature) => {
      const row = database.prepare("SELECT version FROM schema_versions WHERE owner = ?").get(feature.id) as { version: number } | undefined;
      return (row?.version ?? 0) < feature.migrations.length;
    });
  }

  // Brings an open connection up to date and sets sync to stamp every change; run once each time the database opens.
  function open_store(database: SqlDatabase): void {
    database.exec("PRAGMA foreign_keys = ON");
    // Each feature keeps its own schema version, so features grow apart without renumbering each other's steps.
    for (const feature of features) migrate(database, feature.migrations, { owner: feature.id });
    for (const history of histories) history.install(database);
    sync_engine.install(database);
    for (const feature of features) feature.on_open?.(database);
    // What opening changed, such as rows an upgrade moved, is kept as a change made on this device.
    for (const history of histories) history.record(database);
    prune_history(database);
  }

  // Versions older than the days set go, each item keeping its newest; 0 keeps them all.
  function prune_history(database: SqlDatabase): void {
    const days = Math.floor(Number(settings_store.value_of(database, "history_days")));
    if (!(days > 0)) return;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    for (const history of histories) history.prune(database, cutoff);
  }

  // ── Calls ────────────────────────────────────────────────────────────

  const all_methods: Record<string, (database: SqlDatabase, ...args: unknown[]) => unknown> = Object.assign({}, ...features.map((feature) => feature.methods));
  const method_names = Object.keys(all_methods) as (keyof Methods & string)[];

  // Every call described once, for MCP and OpenAPI.
  const api_spec = Object.assign({}, ...features.map((feature) => feature.api)) as ApiSpec<Methods>;

  // The calls a spec marks page-only and the writes of settings only the user may change, which every host refuses a
  // token and an MCP client.
  const page_only: PageOnlyCalls = page_only_calls(api_spec, { rule: settings_store.is_user_only_call, ...(options.page_only_refusal ? { refusal: options.page_only_refusal } : {}) });

  // The calls run on the database given as the caller given, telling on_change after each write so the other pages
  // and devices hear of it.
  function bind_methods(database: () => SqlDatabase, on_change: () => void, caller: Caller = "page"): Methods {
    const bound = method_names.map((name) => {
      const method = all_methods[name]!;
      const call = (...args: unknown[]): unknown => {
        const result = as_caller(caller, () => method(database(), ...args));
        if (is_read_only(name)) return result;
        const done = (value: unknown) => {
          for (const feature of features) feature.after_write?.(database());
          for (const history of histories) history.record(database());
          on_change();
          return value;
        };
        return result instanceof Promise ? result.then(done) : done(result);
      };
      return [name, call];
    });
    return Object.fromEntries(bound) as Methods;
  }

  // ── Backups ──────────────────────────────────────────────────────────

  // Names such as budget-2026-06-10T09-30-00Z-auto.db.
  const naming: BackupNaming = backup_naming(options.backup_prefix, ".db");

  // This device's schedule, kept in a settings row that never syncs.
  function read_backup_schedule(database: SqlDatabase): BackupSchedule {
    const stored = read_setting(database, backup_schedule_key);
    return is_backup_schedule(stored) ? stored : default_backup_schedule;
  }

  // The page's backup calls on any host's backups; a new schedule is checked at once, such as to take a first daily backup.
  function backup_methods(kept: Restorable, database: () => SqlDatabase, check_schedule: () => void): BackupMethods {
    return {
      list_backups: kept.list,
      create_backup: () => kept.create(),
      restore_backup: kept.restore,
      remove_backup: kept.remove,
      get_backup_schedule: () => read_backup_schedule(database()),
      set_backup_schedule: (schedule) => {
        if (!is_backup_schedule(schedule)) throw new Error("A schedule needs automatic as true or false and a whole number to keep.");
        write_setting(database(), backup_schedule_key, schedule);
        check_schedule();
      },
    };
  }

  // ── Bridges ──────────────────────────────────────────────────────────

  const prefix = options.id.replaceAll("-", "_");
  const bridges: AppBridges<Methods> = {
    calls: define_bridge<Methods>(prefix, method_names as never),
    // Sync with the paired devices: this device's own, or in a browser the server's, which only an admin reaches.
    device: define_bridge<SyncDeviceMethods>(`${prefix}_device`, sync_device_method_names),
    // Whether other devices may reach this computer's sync, and on which port.
    peer_listening: define_bridge<PeerListeningMethods>(`${prefix}_peer_listening`, peer_listening_method_names),
    // Backups of this device's data, or in a browser, of the server's, which only an admin reaches.
    backups: define_bridge<BackupMethods>(`${prefix}_backups`, backup_method_names),
    // Server certificates the user chose to trust, such as a home sync server's self-signed one.
    certificates: define_bridge<CertificateMethods>(`${prefix}_certificates`, certificate_method_names),
    // The desktop app's own settings and quitting it completely.
    desktop: define_bridge<DesktopMethods>(`${prefix}_desktop`, desktop_method_names),
    // The daemons the desktop app can work on: this computer's, or a server signed in to as this device.
    connections: define_bridge<ConnectionMethods>(`${prefix}_connections`, connection_method_names),
    // The desktop app's own MCP endpoint, for AI clients on the same computer.
    local_mcp: define_bridge<LocalMcpMethods>(`${prefix}_local_mcp`, local_mcp_method_names),
    events: define_events<AppEvents>(`${prefix}_events`),
  };

  return {
    ...options,
    features,
    settings_store,
    setting_defaults: settings_store.defaults,
    sync_engine,
    needs_upgrade,
    open_store,
    method_names,
    api_spec,
    is_read_only,
    page_only,
    bind_methods,
    backup_naming: naming,
    read_backup_schedule,
    backup_methods,
    bridges,
  };
}

// The calls of whichever app a host runs, so the server, daemon, window and page take every app; an app's own code
// keeps its typed calls from define_app.
type ErasedCalls = any;

// Any X-app as define_app made it, as the hosts that run one whatever its calls see it.
export type App = Omit<ReturnType<typeof define_app<readonly Feature[]>>, "bridges" | "bind_methods" | "api_spec" | "method_names"> & {
  bridges: AppBridges<ErasedCalls>;
  bind_methods: (database: () => SqlDatabase, on_change: () => void, caller?: Caller) => ErasedCalls;
  api_spec: ApiSpec<ErasedCalls>;
  method_names: readonly string[];
};

// The calls of an app define_app made, such as AppMethodsOf<typeof app>.
export type AppMethodsOf<Defined> = Defined extends { bind_methods: (...args: never[]) => infer Methods } ? Methods : never;
