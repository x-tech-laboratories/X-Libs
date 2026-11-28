import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { define_app, is_backup_schedule, is_read_only } from "../src/app/define.ts";
import { read_desktop_settings } from "../src/app/protocol.ts";
import { open_app_database, type AppDatabase } from "../src/app/server.ts";
import { note_history, notes_hooks, sample_app } from "./app/sample_app.ts";

// ============================================================================
// Helpers
// ============================================================================

function open_database(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  sample_app.open_store(database);
  return database;
}

let opened: AppDatabase | null = null;

afterEach(() => {
  opened?.close();
  opened = null;
});

function open_in_temp(): { folder: string; data: AppDatabase } {
  const folder = mkdtempSync(join(tmpdir(), "x-libs-app-db-"));
  opened = open_app_database(sample_app, join(folder, "sample.db"), join(folder, "backups"));
  return { folder, data: opened };
}

// ============================================================================
// Store
// ============================================================================

describe("app store", () => {
  it("records each feature's schema version and opens again without redoing a step", () => {
    const database = open_database();
    sample_app.open_store(database);

    const versions = database.prepare("SELECT owner, version FROM schema_versions ORDER BY owner").all().map((row) => ({ ...row }));

    expect(versions).toEqual([{ owner: "notes", version: 1 }, { owner: "settings", version: 1 }]);
  });

  it("keeps the base's, the app's and each feature's settings, the ones never set at their defaults", () => {
    const database = open_database();
    const methods = sample_app.bind_methods(() => database, () => undefined);

    methods.set_setting("currency", "JMD");

    expect(sample_app.setting_defaults).toMatchObject({ history_days: 365, currency: "USD", "notes.sort": "title" });
    expect(methods.get_settings()).toEqual({ ...sample_app.setting_defaults, currency: "JMD" });
  });

  it("keeps this device's backup schedule out of sync and out of a settings export", () => {
    const database = open_database();
    const methods = sample_app.bind_methods(() => database, () => undefined);

    methods.set_setting("currency", "JMD");
    methods.set_setting("backup_schedule", { automatic: false, to_keep: 3 });

    expect(methods.export_settings().settings).toEqual({ currency: "JMD" });
    expect(sample_app.settings_store.local_keys).toEqual(["backup_schedule"]);
  });

  it("announces writes, sync or not, and records a version after each, but not after a read", async () => {
    const database = open_database();
    const on_change = vi.fn();
    const methods = sample_app.bind_methods(() => database, on_change);

    methods.list_notes();
    const id = methods.add_note("Groceries");
    await methods.rename_note(id, "Shopping");

    expect(on_change).toHaveBeenCalledTimes(2);
    expect(note_history.read_versions(database, id).map((version) => version.snapshot?.title)).toEqual(["Shopping", "Groceries"]);
    expect(sample_app.sync_engine.collect_changes_since(database, 0, "").changes.some((change) => change.table === "notes")).toBe(true);
  });

  it("describes every call of every feature once", () => {
    expect(sample_app.method_names).toEqual(expect.arrayContaining(["get_settings", "set_setting", "list_notes", "add_note"]));
    expect(Object.keys(sample_app.api_spec)).toEqual(expect.arrayContaining(sample_app.method_names));
  });

  it("tells reads from writes by their names", () => {
    expect(is_read_only("list_notes")).toBe(true);
    expect(is_read_only("export_settings")).toBe(true);
    expect(is_read_only("add_note")).toBe(false);
  });

  it("tells a database with steps to run from a new or current one", () => {
    const database = new DatabaseSync(":memory:");
    expect(sample_app.needs_upgrade(database)).toBe(false);

    sample_app.open_store(database);
    expect(sample_app.needs_upgrade(database)).toBe(false);

    database.prepare("UPDATE schema_versions SET version = 0 WHERE owner = 'notes'").run();
    expect(sample_app.needs_upgrade(database)).toBe(true);
  });

  it("prunes versions older than the days set, each note keeping its newest", async () => {
    const database = open_database();
    const methods = sample_app.bind_methods(() => database, () => undefined);
    const id = methods.add_note("Old");
    database.prepare("UPDATE note_versions SET changed_at = '2000-01-01T00:00:00.000Z'").run();
    await methods.rename_note(id, "New");

    sample_app.open_store(database);

    expect(note_history.read_versions(database, id).map((version) => version.snapshot?.title)).toEqual(["New"]);
  });

  it("names its bridges after the app", () => {
    expect(sample_app.bridges.calls.api_name).toBe("x_sample");
    expect(sample_app.bridges.device.api_name).toBe("x_sample_device");
    expect(sample_app.bridges.events.api_name).toBe("x_sample_events");
  });
});

// ============================================================================
// Desktop settings and schedules
// ============================================================================

describe("history days", () => {
  it("keeps the app's own default for how far the history reaches back, 365 unless it gives one", () => {
    const short = define_app({ id: "x-short", name: "X-Short", env_prefix: "X_SHORT", version: "1", summary: "", instructions: "", data_name: "notes", database_file: "short.db", backup_prefix: "short", ports: { server: 1, peer: 2 }, server_example: "", features: [], history_days: 180 });

    expect(short.setting_defaults).toMatchObject({ history_days: 180 });
    expect(sample_app.setting_defaults).toMatchObject({ history_days: 365 });
  });
});

describe("feature hooks and callers", () => {
  it("tells a feature when the database opens and after every write, but not after a read", async () => {
    const before = { ...notes_hooks };
    const database = open_database();
    const methods = sample_app.bind_methods(() => database, () => undefined);

    methods.add_note("Groceries");
    await methods.rename_note("note-x", "Shopping");
    methods.list_notes();

    expect(notes_hooks.opened).toBe(before.opened + 1);
    expect(notes_hooks.writes).toBe(before.writes + 2);
  });

  it("keeps what opening changed as a version made on this device", () => {
    const database = open_database();
    sample_app.bind_methods(() => database, () => undefined).add_note("rename me");

    sample_app.open_store(database);

    const id = (database.prepare("SELECT id FROM notes").get() as { id: string }).id;
    expect(note_history.read_versions(database, id).map((version) => version.snapshot.title)).toContain("Renamed on opening");
  });

  it("runs each call as the caller it is bound for, the page unless told", () => {
    const database = open_database();

    expect(sample_app.bind_methods(() => database, () => undefined).get_note_caller()).toBe("page");
    expect(sample_app.bind_methods(() => database, () => undefined, "engine").get_note_caller()).toBe("engine");
  });

  it("marks the specs' page-only calls and the user-only settings' writes as page-only", () => {
    expect(sample_app.page_only.is_page_only("clear_notes")).toBe(true);
    expect(sample_app.page_only.is_page_only_call("set_setting", ["notes.locked", true])).toBe(true);
    expect(sample_app.page_only.is_page_only_call("set_setting", ["currency", "EUR"])).toBe(false);
  });
});

describe("desktop settings", () => {
  it("fills in each default where a setting is missing or damaged", () => {
    expect(read_desktop_settings(null)).toEqual({ show_tray_icon: true, keep_running_in_background: true, start_at_login: true });
    expect(read_desktop_settings({ keep_running_in_background: false, start_at_login: "yes" })).toEqual({ show_tray_icon: true, keep_running_in_background: false, start_at_login: true });
  });

  it("keeps the app's own switches beside the base's, and drops keys it does not know", () => {
    const own = { notify_inbox: { default: true, label: "Inbox notifications" } };

    expect(read_desktop_settings({ notify_inbox: false, stray: true }, own)).toEqual({ show_tray_icon: true, keep_running_in_background: true, start_at_login: true, notify_inbox: false });
    expect(read_desktop_settings(null, own).notify_inbox).toBe(true);
  });

  it("takes a backup schedule only with a whole number to keep", () => {
    expect(is_backup_schedule({ automatic: true, to_keep: 3 })).toBe(true);
    expect(is_backup_schedule({ automatic: true, to_keep: -1 })).toBe(false);
    expect(is_backup_schedule(null)).toBe(false);
  });
});

// ============================================================================
// Database file
// ============================================================================

describe("app database", { timeout: 30_000 }, () => {
  it("takes a daily backup on opening and one by hand, named for the app", async () => {
    const { data } = open_in_temp();
    await vi.waitFor(async () => expect((await data.backup_methods.list_backups()).some((backup) => backup.is_automatic)).toBe(true));

    await data.backup_methods.create_backup();

    const listed = await data.backup_methods.list_backups();
    expect(listed.some((backup) => !backup.is_automatic)).toBe(true);
    expect(listed.every((backup) => /^sample-.*\.db$/.test(backup.name))).toBe(true);
  });

  it("restores a backup, backing up the current data first, and keeps answering on the new connection", async () => {
    const { data } = open_in_temp();
    const methods = sample_app.bind_methods(data.database, () => undefined);
    const id = methods.add_note("Before");
    const before = await data.backup_methods.create_backup();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await methods.rename_note(id, "After");

    await data.backup_methods.restore_backup(before.name);

    expect(methods.list_notes()).toEqual([{ id, title: "Before" }]);
    expect((await data.backup_methods.list_backups()).filter((backup) => !backup.is_automatic)).toHaveLength(2);
  });

  it("keeps the schedule on this device, out of what syncs, and refuses a damaged one", () => {
    const { data } = open_in_temp();
    expect(data.backup_methods.get_backup_schedule()).toEqual({ automatic: true, to_keep: 14 });

    data.backup_methods.set_backup_schedule({ automatic: false, to_keep: 3 });

    expect(data.backup_methods.get_backup_schedule()).toEqual({ automatic: false, to_keep: 3 });
    const changes = sample_app.sync_engine.collect_changes_since(data.database(), 0, "").changes;
    expect(changes.some((change) => change.table === "settings" && change.key === "backup_schedule")).toBe(false);
    expect(() => data.backup_methods.set_backup_schedule({ automatic: true, to_keep: -1 })).toThrow("whole number");
  });

  it("backs up a database before upgrading it", () => {
    const { folder, data } = open_in_temp();
    data.database().prepare("UPDATE schema_versions SET version = 0 WHERE owner = 'notes'").run();
    data.database().exec("DROP TABLE notes");
    data.close();

    opened = open_app_database(sample_app, join(folder, "sample.db"), join(folder, "backups"));

    expect(readdirSync(join(folder, "backups")).some((name) => /^sample-.*\.db$/.test(name))).toBe(true);
  });
});
