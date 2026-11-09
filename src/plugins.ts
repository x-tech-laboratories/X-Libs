// Plugins for an X-app: bundled or loaded ones started in the order they need each other, whose hooks, providers, commands, slot contents and settings go away when they stop.

import { createHooks, type Hookable } from "hookable";
import satisfies from "semver/functions/satisfies.js";
import valid from "semver/functions/valid.js";

// ── What a plugin is ─────────────────────────────────────────────────────────

export type SettingValue = string | number | boolean;
export type SettingValues = Record<string, SettingValue>;

interface SettingBase {
  key: string;
  label: string;
  hint?: string;
}

export type SettingField =
  | (SettingBase & { type: "text"; default: string; placeholder?: string })
  | (SettingBase & { type: "number"; default: number; min?: number; max?: number; step?: number })
  | (SettingBase & { type: "switch"; default: boolean })
  | (SettingBase & { type: "choice"; default: string; choices: { value: string; label: string }[] });

export interface PluginManifest {
  // Dotted and unique across apps, such as "x-stream.youtubejs".
  id: string;
  name: string;
  // Semver, such as "1.2.0".
  version: string;
  description?: string;
  // The app's id; a plugin for another app is refused.
  app?: string;
  // The app versions it works with as a semver range, such as "^2.0.0".
  app_versions?: string;
  // Plugins that must be running first, by id, with the versions it works with.
  requires?: Record<string, string>;
  // Whether it starts before anyone turns it on; it does by default.
  enabled_by_default?: boolean;
  settings?: SettingField[];
}

// What an app lets its plugins reach. Each map is keyed by name; the app writes its own.
export interface PluginApi {
  // The arguments each hook is called with, such as { "task.created": (task: Task) => void }.
  hooks?: Record<string, AnyHandler>;
  // The shape each provider point takes, such as { video_source: VideoSource }.
  providers?: Record<string, unknown>;
  // What each slot is filled with, such as { sidebar: ComponentType<{ task: Task }> }.
  slots?: Record<string, unknown>;
  // Anything else the app hands every plugin, such as its database or its React.
  services?: unknown;
}

// oxlint-disable-next-line no-explicit-any -- a hook map is keyed by name with any arguments, as hookable types it.
type AnyHandler = (...args: any[]) => void | Promise<void>;

type HooksOf<Api extends PluginApi> = Api["hooks"] extends Record<string, unknown> ? NonNullable<Api["hooks"]> : Record<string, never>;
type ProvidersOf<Api extends PluginApi> = Api["providers"] extends Record<string, unknown> ? Api["providers"] : Record<string, never>;
type SlotsOf<Api extends PluginApi> = Api["slots"] extends Record<string, unknown> ? Api["slots"] : Record<string, never>;

export interface PluginCommand {
  // Unique within the plugin; the host lists it as "<plugin id>.<id>".
  id: string;
  label: string;
  // Keys in the shortcuts' syntax, such as "mod+shift+p".
  keys?: string;
  run: () => void | Promise<void>;
}

export interface PluginContext<Api extends PluginApi = PluginApi> {
  manifest: PluginManifest;
  app: AppInfo;
  services: Api["services"];
  hook<Name extends keyof HooksOf<Api> & string>(name: Name, handler: HooksOf<Api>[Name]): void;
  // Adds one implementation of a provider point under an id of its own, such as "youtube".
  provide<Point extends keyof ProvidersOf<Api> & string>(point: Point, id: string, value: ProvidersOf<Api>[Point]): void;
  add_command(command: PluginCommand): void;
  fill_slot<Slot extends keyof SlotsOf<Api> & string>(slot: Slot, value: SlotsOf<Api>[Slot]): void;
  // The plugin's settings with the defaults filled in.
  settings(): SettingValues;
  on_settings_change(listener: (values: SettingValues) => void): void;
  // Runs when the plugin stops, after its stop and before the host removes what it added.
  on_stop(cleanup: () => void | Promise<void>): void;
}

export interface Plugin<Api extends PluginApi = PluginApi> extends PluginManifest {
  start(context: PluginContext<Api>): void | Promise<void>;
  stop?(): void | Promise<void>;
}

// Types a plugin against its app's API without restating the generic at each call.
export function define_plugin<Api extends PluginApi>(plugin: Plugin<Api>): Plugin<Api> {
  return plugin;
}

// ── The host ─────────────────────────────────────────────────────────────────

export interface AppInfo {
  id: string;
  version: string;
}

// Whether each plugin is on and its settings, by plugin id.
export type PluginRecords = Record<string, { enabled?: boolean; settings?: SettingValues }>;

export interface PluginStorage {
  read(): PluginRecords | undefined | Promise<PluginRecords | undefined>;
  write(records: PluginRecords): void | Promise<void>;
}

export type PluginState = "running" | "off" | "waiting" | "failed" | "unsupported";

export interface PluginStatus {
  manifest: PluginManifest;
  state: PluginState;
  // Why it is waiting, failed or unsupported.
  problem?: string;
}

export interface Contribution<Value> {
  plugin_id: string;
  value: Value;
}

export interface Provided<Value> extends Contribution<Value> {
  id: string;
}

export interface HostCommand extends PluginCommand {
  plugin_id: string;
}

export interface PluginHostOptions<Api extends PluginApi> {
  app: AppInfo;
  services?: Api["services"];
  // Where on/off and settings are kept; in memory when left out.
  storage?: PluginStorage;
  // Told when a plugin fails to start or stop, or one of its hooks throws.
  on_error?: (plugin_id: string, error: unknown) => void;
}

export interface PluginHost<Api extends PluginApi = PluginApi> {
  // Adds a plugin; once the host has started, it starts at once if it is on.
  add(plugin: Plugin<Api>): Promise<void>;
  // Reads the storage and starts every plugin that is on and has what it requires.
  start(): Promise<void>;
  // Stops every plugin, the ones others require last.
  stop(): Promise<void>;
  enable(id: string): Promise<void>;
  // Stops the plugin and those that require it, which wait until it is back.
  disable(id: string): Promise<void>;
  list(): PluginStatus[];
  // Calls a hook's handlers one after another, the app's own and every running plugin's.
  call<Name extends keyof HooksOf<Api> & string>(name: Name, ...args: Parameters<HooksOf<Api>[Name]>): Promise<void>;
  call_parallel<Name extends keyof HooksOf<Api> & string>(name: Name, ...args: Parameters<HooksOf<Api>[Name]>): Promise<void>;
  // The app's own handler; returns the function that removes it.
  hook<Name extends keyof HooksOf<Api> & string>(name: Name, handler: HooksOf<Api>[Name]): () => void;
  providers<Point extends keyof ProvidersOf<Api> & string>(point: Point): Provided<ProvidersOf<Api>[Point]>[];
  // The provider with this id, or the first one when no id is given or it is gone.
  provider<Point extends keyof ProvidersOf<Api> & string>(point: Point, id?: string): Provided<ProvidersOf<Api>[Point]> | undefined;
  commands(): HostCommand[];
  slot<Slot extends keyof SlotsOf<Api> & string>(slot: Slot): Contribution<SlotsOf<Api>[Slot]>[];
  settings(id: string): SettingValues;
  set_settings(id: string, values: SettingValues): Promise<void>;
  // Bumped on every change a page shows, for web/react/watch's use_watch.
  watch: { version(): number; subscribe(listener: () => void): () => void };
}

interface Entry<Api extends PluginApi> {
  plugin: Plugin<Api>;
  state: PluginState;
  problem?: string;
  enabled: boolean;
  settings: SettingValues;
  cleanups: (() => void | Promise<void>)[];
  settings_listeners: ((values: SettingValues) => void)[];
}

export function create_plugin_host<Api extends PluginApi = PluginApi>(options: PluginHostOptions<Api>): PluginHost<Api> {
  const hooks: Hookable<Record<string, AnyHandler>> = createHooks();
  const entries = new Map<string, Entry<Api>>();
  const providers = new Map<string, Provided<unknown>[]>();
  const slots = new Map<string, Contribution<unknown>[]>();
  const commands: HostCommand[] = [];
  const report = options.on_error ?? (() => {});
  let records: PluginRecords = {};
  let started = false;
  // Serializes every change so two toggles never interleave their starts and stops.
  let queue: Promise<unknown> = Promise.resolve();

  let version = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  function in_turn<Result>(work: () => Promise<Result>): Promise<Result> {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }

  async function save(): Promise<void> {
    await options.storage?.write(records);
  }

  function unsupported_because(plugin: Plugin<Api>): string | undefined {
    if (!plugin.id || !plugin.name || typeof plugin.start !== "function") return "It has no id, name or start.";
    if (!valid(plugin.version)) return `Its version "${plugin.version}" is not semver.`;
    if (plugin.app && plugin.app !== options.app.id) return `It is for ${plugin.app}, not ${options.app.id}.`;
    if (plugin.app_versions && !satisfies(options.app.version, plugin.app_versions, { includePrerelease: true })) {
      return `It needs ${options.app.id} ${plugin.app_versions}; this is ${options.app.version}.`;
    }
    return undefined;
  }

  function missing_requirement(plugin: Plugin<Api>): string | undefined {
    for (const [id, range] of Object.entries(plugin.requires ?? {})) {
      const required = entries.get(id);
      if (!required) return `It needs ${id} ${range}, which is not installed.`;
      if (!satisfies(required.plugin.version, range, { includePrerelease: true })) return `It needs ${id} ${range}; ${required.plugin.version} is installed.`;
      if (required.state !== "running") return `It needs ${required.plugin.name} running.`;
    }
    return undefined;
  }

  function filled_settings(plugin: Plugin<Api>, stored: SettingValues = {}): SettingValues {
    const values: SettingValues = {};
    for (const field of plugin.settings ?? []) {
      const value = stored[field.key];
      values[field.key] = fits(field, value) ? value : field.default;
    }
    return values;
  }

  function context_for(entry: Entry<Api>): PluginContext<Api> {
    const plugin_id = entry.plugin.id;
    const remove_from = <Item>(list: Item[], item: Item) => {
      const at = list.indexOf(item);
      if (at >= 0) list.splice(at, 1);
    };
    return {
      manifest: manifest_of(entry.plugin),
      app: options.app,
      services: options.services as Api["services"],
      hook(name, handler) {
        const guarded = async (...args: unknown[]) => {
          try {
            await (handler as AnyHandler)(...args);
          } catch (error) {
            report(plugin_id, error);
          }
        };
        entry.cleanups.push(hooks.hook(name, guarded));
      },
      provide(point, id, value) {
        const list = providers.get(point) ?? [];
        const item: Provided<unknown> = { plugin_id, id, value };
        list.push(item);
        providers.set(point, list);
        entry.cleanups.push(() => remove_from(list, item));
      },
      add_command(command) {
        const item: HostCommand = { ...command, id: `${plugin_id}.${command.id}`, plugin_id };
        commands.push(item);
        entry.cleanups.push(() => remove_from(commands, item));
      },
      fill_slot(slot, value) {
        const list = slots.get(slot) ?? [];
        const item: Contribution<unknown> = { plugin_id, value };
        list.push(item);
        slots.set(slot, list);
        entry.cleanups.push(() => remove_from(list, item));
      },
      settings: () => ({ ...entry.settings }),
      on_settings_change(listener) {
        entry.settings_listeners.push(listener);
      },
      on_stop(cleanup) {
        entry.cleanups.push(cleanup);
      },
    };
  }

  async function run_cleanups(entry: Entry<Api>): Promise<void> {
    for (const cleanup of entry.cleanups.splice(0).reverse()) {
      try {
        await cleanup();
      } catch (error) {
        report(entry.plugin.id, error);
      }
    }
    entry.settings_listeners = [];
  }

  async function start_one(entry: Entry<Api>): Promise<void> {
    entry.state = "running";
    entry.problem = undefined;
    try {
      await entry.plugin.start(context_for(entry));
    } catch (error) {
      await run_cleanups(entry);
      entry.state = "failed";
      entry.problem = error instanceof Error ? error.message : String(error);
      report(entry.plugin.id, error);
    }
  }

  async function stop_one(entry: Entry<Api>): Promise<void> {
    if (entry.state !== "running") return;
    try {
      await entry.plugin.stop?.();
    } catch (error) {
      report(entry.plugin.id, error);
    }
    await run_cleanups(entry);
    entry.state = "off";
  }

  // Starts what can start, again and again until a pass starts nothing, so a plugin may be added before what it requires.
  async function settle(): Promise<void> {
    let progressed = started;
    while (progressed) {
      progressed = false;
      for (const entry of entries.values()) {
        if (entry.state === "running" || entry.state === "unsupported") continue;
        if (!entry.enabled) {
          entry.state = "off";
          entry.problem = undefined;
          continue;
        }
        if (entry.state === "failed") continue;
        const problem = missing_requirement(entry.plugin);
        if (problem) {
          entry.state = "waiting";
          entry.problem = problem;
          continue;
        }
        await start_one(entry);
        progressed = true;
      }
    }
    bump();
  }

  // Stops the plugin's dependents before the plugin itself.
  async function stop_with_dependents(entry: Entry<Api>): Promise<void> {
    for (const other of entries.values()) {
      if (other.state === "running" && other.plugin.requires && entry.plugin.id in other.plugin.requires) await stop_with_dependents(other);
    }
    await stop_one(entry);
  }

  function entry_of(id: string): Entry<Api> {
    const entry = entries.get(id);
    if (!entry) throw new Error(`No plugin "${id}" is installed.`);
    return entry;
  }

  return {
    add: (plugin) => in_turn(async () => {
      if (entries.has(plugin.id)) throw new Error(`A plugin "${plugin.id}" is already installed.`);
      const problem = unsupported_because(plugin);
      const record = records[plugin.id];
      entries.set(plugin.id, {
        plugin,
        state: problem ? "unsupported" : "off",
        problem,
        enabled: record?.enabled ?? plugin.enabled_by_default ?? true,
        settings: filled_settings(plugin, record?.settings),
        cleanups: [],
        settings_listeners: [],
      });
      await settle();
    }),

    start: () => in_turn(async () => {
      if (started) return;
      records = (await options.storage?.read()) ?? {};
      for (const entry of entries.values()) {
        const record = records[entry.plugin.id];
        if (record?.enabled !== undefined) entry.enabled = record.enabled;
        entry.settings = filled_settings(entry.plugin, record?.settings);
      }
      started = true;
      await settle();
    }),

    stop: () => in_turn(async () => {
      for (const entry of [...entries.values()].reverse()) await stop_with_dependents(entry);
      started = false;
      bump();
    }),

    enable: (id) => in_turn(async () => {
      const entry = entry_of(id);
      entry.enabled = true;
      if (entry.state === "failed") entry.state = "off";
      records = { ...records, [id]: { ...records[id], enabled: true } };
      await save();
      await settle();
    }),

    disable: (id) => in_turn(async () => {
      const entry = entry_of(id);
      entry.enabled = false;
      records = { ...records, [id]: { ...records[id], enabled: false } };
      await save();
      await stop_with_dependents(entry);
      await settle();
    }),

    list: () => [...entries.values()].map((entry) => ({ manifest: manifest_of(entry.plugin), state: entry.state, problem: entry.problem })),

    call: async (name, ...args) => {
      await hooks.callHook(name, ...(args as unknown[]));
    },

    call_parallel: async (name, ...args) => {
      await hooks.callHookParallel(name, ...(args as unknown[]));
    },

    hook: (name, handler) => hooks.hook(name, handler as AnyHandler),

    providers: (point) => [...(providers.get(point) ?? [])] as Provided<ProvidersOf<Api>[typeof point]>[],

    provider(point, id) {
      const list = (providers.get(point) ?? []) as Provided<ProvidersOf<Api>[typeof point]>[];
      return list.find((item) => item.id === id) ?? list[0];
    },

    commands: () => [...commands],

    slot: (slot) => [...(slots.get(slot) ?? [])] as Contribution<SlotsOf<Api>[typeof slot]>[],

    settings: (id) => ({ ...entry_of(id).settings }),

    set_settings: (id, values) => in_turn(async () => {
      const entry = entry_of(id);
      entry.settings = filled_settings(entry.plugin, { ...entry.settings, ...values });
      records = { ...records, [id]: { ...records[id], settings: entry.settings } };
      await save();
      for (const listener of entry.settings_listeners) {
        try {
          listener({ ...entry.settings });
        } catch (error) {
          report(id, error);
        }
      }
      bump();
    }),

    watch: {
      version: () => version,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function manifest_of(plugin: PluginManifest): PluginManifest {
  const { id, name, version, description, app, app_versions, requires, enabled_by_default, settings } = plugin;
  return { id, name, version, description, app, app_versions, requires, enabled_by_default, settings };
}

// Whether a stored value still suits its field, so a changed manifest falls back to the default.
export function fits(field: SettingField, value: unknown): value is SettingValue {
  switch (field.type) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
    case "switch":
      return typeof value === "boolean";
    case "choice":
      return typeof value === "string" && field.choices.some((choice) => choice.value === value);
  }
}

// Storage in a key of any string store, such as web/prefs' browser storage or a file the server reads and writes.
export function json_plugin_storage(store: { get(): string | null | undefined; set(text: string): void | Promise<void> }): PluginStorage {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(store.get() ?? "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PluginRecords) : {};
      } catch {
        return {};
      }
    },
    write: (records) => store.set(JSON.stringify(records)),
  };
}
