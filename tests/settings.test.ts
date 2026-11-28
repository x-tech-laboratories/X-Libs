import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { page_only_calls } from "../src/api_spec.ts";
import { hidden_secret } from "../src/plugins.ts";
import { create_settings_store, read_setting, read_settings_file, settings_migration, settings_of, write_setting, type SettingSpec } from "../src/settings.ts";
import { migrate, type SqlDatabase } from "../src/sql.ts";

// ============================================================================
// Setup
// ============================================================================

const app = { id: "x-example", name: "X-Example" };

const common: Record<string, SettingSpec> = settings_of({ "history.keep_days": 180, currency: "USD" });
const policy: Record<string, SettingSpec> = settings_of({ action_policy: { send: "ask" } }, { user_only: true });
const device: Record<string, SettingSpec> = { backup_schedule: { default: { keep: 14 }, local: true } };
const services: Record<string, SettingSpec> = {
  "library.api_key": { default: "", secret: true },
  item_sources: {
    default: [],
    hide: (value) => (value as { token: string }[]).map((source) => ({ ...source, token: source.token ? hidden_secret : "" })),
    keep: (stored, incoming) => (incoming as { token: string }[]).map((source, index) => (source.token === hidden_secret ? { ...source, token: (stored as { token: string }[])[index]?.token ?? "" } : source)),
  },
};

function open(): SqlDatabase {
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  migrate(database, [settings_migration], { owner: "settings" });
  return database;
}

function store() {
  return create_settings_store([common, policy, device, services], { app, knows: (key) => key.startsWith("diet.target_"), key_example: "currency" });
}

// ============================================================================
// Rows
// ============================================================================

test("a setting reads back as the JSON written, and undefined while unset", () => {
  const database = open();

  write_setting(database, "currency", "JMD");
  write_setting(database, "currency", "EUR");

  expect(read_setting(database, "currency")).toBe("EUR");
  expect(read_setting(database, "locale")).toBeUndefined();
  expect(database.prepare("SELECT value FROM settings WHERE key = 'currency'").get()).toEqual({ value: '"EUR"' });
});

test("a database the apps made under the owner settings needs no new step", () => {
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  migrate(database, [`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`], { owner: "settings" });
  write_setting(database, "currency", "JMD");
  const settings = store();

  migrate(database, settings.migrations, { owner: settings.id });

  expect(database.prepare("SELECT version FROM schema_versions WHERE owner = 'settings'").get()).toEqual({ version: 1 });
  expect(settings.methods.get_settings(database).currency).toBe("JMD");
});

// ============================================================================
// Store
// ============================================================================

test("the store gathers defaults, user-only keys and this device's keys from every feature", () => {
  const settings = store();

  expect(settings.defaults).toEqual({ "history.keep_days": 180, currency: "USD", action_policy: { send: "ask" }, backup_schedule: { keep: 14 }, "library.api_key": "", item_sources: [] });
  expect([...settings.user_only]).toEqual(["action_policy"]);
  expect(settings.tables).toEqual([{ name: "settings", key_columns: ["key"], local_keys: ["backup_schedule"] }]);
  expect(create_settings_store([common], { app }).tables).toEqual([{ name: "settings", key_columns: ["key"] }]);
});

test("a key two features declare is refused", () => {
  expect(() => create_settings_store([common, settings_of({ currency: "JMD" })], { app })).toThrow("The setting currency is declared twice.");
});

test("get_settings lays the stored values over the defaults with secrets hidden", () => {
  const database = open();
  const settings = store();

  settings.methods.set_setting(database, "currency", "JMD");
  settings.methods.set_setting(database, "library.api_key", "abc");
  settings.methods.set_setting(database, "item_sources", [{ token: "t1" }, { token: "" }]);

  expect(settings.methods.get_settings(database)).toMatchObject({ currency: "JMD", "history.keep_days": 180, "library.api_key": hidden_secret, item_sources: [{ token: hidden_secret }, { token: "" }] });
  expect(settings.value_of(database, "library.api_key")).toBe("abc");
  expect(settings.value_of(database, "history.keep_days")).toBe(180);
});

test("a hidden secret written back keeps the stored one, and a new one replaces it", () => {
  const database = open();
  const settings = store();
  settings.methods.set_setting(database, "library.api_key", "abc");
  settings.methods.set_setting(database, "item_sources", [{ token: "t1" }]);

  settings.methods.set_setting(database, "library.api_key", hidden_secret);
  settings.methods.set_setting(database, "item_sources", [{ token: hidden_secret }, { token: "t2" }]);

  expect(read_setting(database, "library.api_key")).toBe("abc");
  expect(read_setting(database, "item_sources")).toEqual([{ token: "t1" }, { token: "t2" }]);

  settings.methods.set_setting(database, "library.api_key", "xyz");
  expect(read_setting(database, "library.api_key")).toBe("xyz");
});

test("an empty secret reads as empty, not hidden", () => {
  const database = open();
  const settings = store();

  expect(settings.methods.get_settings(database)["library.api_key"]).toBe("");
});

// ============================================================================
// Who may write
// ============================================================================

test("only the user may write a user-only setting, import one or export secrets", () => {
  const settings = store();
  const file = { app: app.id, kind: "settings", version: 1, exported_at: "", settings: { action_policy: {} } };

  expect(settings.is_user_only_call("set_setting", ["action_policy", {}])).toBe(true);
  expect(settings.is_user_only_call("set_setting", ["currency", "JMD"])).toBe(false);
  expect(settings.is_user_only_call("export_settings", [true])).toBe(true);
  expect(settings.is_user_only_call("export_settings", [])).toBe(false);
  expect(settings.is_user_only_call("import_settings", [file])).toBe(true);
  expect(settings.is_user_only_call("import_settings", [JSON.stringify({ ...file, settings: { currency: "JMD" } })])).toBe(false);
  expect(settings.is_user_only_call("import_settings", ["not json"])).toBe(false);
  expect(settings.is_user_only_call("get_settings", [])).toBe(false);
});

test("the rule works through page_only_calls with named arguments", () => {
  const settings = store();
  const page_only = page_only_calls(settings.api, { rule: settings.is_user_only_call });

  expect(page_only.is_page_only_request("set_setting", { key: "action_policy", value: {} })).toBe(true);
  expect(page_only.is_page_only_request("set_setting", { key: "currency", value: "JMD" })).toBe(false);
  expect(page_only.is_page_only_request("export_settings", { include_secrets: true })).toBe(true);
});

test("only the user's own devices sync a user-only row", () => {
  const settings = store();

  expect(settings.is_device_only({ table: "settings", key: "action_policy" })).toBe(true);
  expect(settings.is_device_only({ table: "settings", key: "currency" })).toBe(false);
  expect(settings.is_device_only({ table: "items", key: "action_policy" })).toBe(false);
});

// ============================================================================
// Settings file
// ============================================================================

test("an export holds the shared settings set, its secrets left out unless asked for", () => {
  const database = open();
  const settings = store();
  settings.methods.set_setting(database, "currency", "JMD");
  settings.methods.set_setting(database, "backup_schedule", { keep: 3 });
  settings.methods.set_setting(database, "library.api_key", "abc");
  settings.methods.set_setting(database, "item_sources", [{ token: "t1" }]);

  const plain = settings.methods.export_settings(database);
  const full = settings.methods.export_settings(database, true);

  expect(plain).toMatchObject({ app: app.id, kind: "settings", version: 1, settings: { currency: "JMD", item_sources: [{ token: hidden_secret }] } });
  expect(Object.keys(plain.settings).sort()).toEqual(["currency", "item_sources"]);
  expect(full.settings).toEqual({ currency: "JMD", "library.api_key": "abc", item_sources: [{ token: "t1" }] });
  expect(Number.isNaN(Date.parse(plain.exported_at))).toBe(false);
});

test("an import sets what changed and ignores unknown keys and this device's own", () => {
  const source = open();
  const target = open();
  const settings = store();
  settings.methods.set_setting(source, "currency", "JMD");
  settings.methods.set_setting(source, "library.api_key", "abc");
  settings.methods.set_setting(target, "library.api_key", "kept");
  const file = settings.methods.export_settings(source);
  file.settings = { ...file.settings, "history.keep_days": 180, "diet.target_protein": 120, unknown: 1, backup_schedule: { keep: 1 }, "": 2 };

  const result = settings.methods.import_settings(target, JSON.stringify(file));

  expect(result).toEqual({ changed: 2, unchanged: 1 });
  expect(read_setting(target, "currency")).toBe("JMD");
  expect(read_setting(target, "diet.target_protein")).toBe(120);
  expect(read_setting(target, "history.keep_days")).toBeUndefined();
  expect(read_setting(target, "library.api_key")).toBe("kept");
  expect(read_setting(target, "unknown")).toBeUndefined();
  expect(read_setting(target, "backup_schedule")).toBeUndefined();
});

test("a file from another app, a newer version or no settings is refused", () => {
  const file = { app: app.id, kind: "settings", version: 1, exported_at: "", settings: {} };

  expect(read_settings_file(app, file)).toEqual({});
  expect(() => read_settings_file(app, "{")).toThrow("That file is not JSON.");
  expect(() => read_settings_file(app, { ...file, app: "x-other" })).toThrow("That file was not made by X-Example.");
  expect(() => read_settings_file(app, { ...file, kind: "library" })).toThrow("That file holds no settings.");
  expect(() => read_settings_file(app, { ...file, settings: [] })).toThrow("That file holds no settings.");
  expect(() => read_settings_file(app, { ...file, version: 2 })).toThrow("That file was made by a newer X-Example; update this one first.");
  expect(() => read_settings_file(app, null)).toThrow("That file was not made by X-Example.");
});

// ============================================================================
// Api
// ============================================================================

test("the api describes every call, with the app's own words where given", () => {
  const settings = create_settings_store([common], { app, descriptions: { get_settings: "The units shown." } });

  expect(settings.api.get_settings.description).toBe("The units shown.");
  expect(Object.keys(settings.api)).toEqual(["get_settings", "set_setting", "export_settings", "import_settings"]);
  expect(store().api.set_setting.params[0]!.schema.description).toBe("The setting's key, such as currency.");
  expect(settings.api.export_settings.params[0]!.optional).toBe(true);
});
