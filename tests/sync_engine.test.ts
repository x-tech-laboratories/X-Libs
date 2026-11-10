import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { migrate, type SqlDatabase } from "../src/sql.ts";
import { create_sync_engine } from "../src/sync_engine.ts";

const engine = create_sync_engine({
  tables: [
    { name: "lists", key_columns: ["id"] },
    { name: "items", key_columns: ["id"], local_columns: ["seen_here"] },
    { name: "settings", key_columns: ["key"], local_keys: ["window_size"] },
  ],
});

function open_device(): SqlDatabase {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  migrate(database, [
    `CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL);
     CREATE TABLE items (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, seen_here INTEGER);
     CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ]);
  engine.install(database);
  return database;
}

// Sends one device's unpushed changes to another and marks them pushed.
function push(from: SqlDatabase, to: SqlDatabase): number {
  const outgoing = engine.collect_unpushed_changes(from);
  engine.write_state(from, { pushed_seq: outgoing.up_to_seq });
  return engine.apply_changes(to, outgoing.changes);
}

function rows(database: SqlDatabase, sql: string): unknown[] {
  return database.prepare(sql).all().map((row) => ({ ...(row as object) }));
}

describe("sync engine", () => {
  it("carries new rows, edits and deletes from one device to another", () => {
    const phone = open_device();
    const desktop = open_device();

    phone.exec("INSERT INTO lists VALUES ('l1', 'Push day'); INSERT INTO items (id, list_id, title) VALUES ('i1', 'l1', 'Bench')");
    push(phone, desktop);
    expect(rows(desktop, "SELECT id, title, done FROM items")).toEqual([{ id: "i1", title: "Bench", done: 0 }]);

    phone.exec("UPDATE items SET done = 1 WHERE id = 'i1'");
    push(phone, desktop);
    expect(rows(desktop, "SELECT done FROM items")).toEqual([{ done: 1 }]);

    phone.exec("DELETE FROM items WHERE id = 'i1'");
    push(phone, desktop);
    expect(rows(desktop, "SELECT * FROM items")).toEqual([]);
  });

  it("keeps edits to different values of one row from two devices, and the later edit of the same value", () => {
    const phone = open_device();
    const desktop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Push day'); INSERT INTO items (id, list_id, title) VALUES ('i1', 'l1', 'Bench')");
    push(phone, desktop);

    phone.exec("UPDATE items SET title = 'Incline bench' WHERE id = 'i1'");
    desktop.exec("UPDATE items SET done = 1 WHERE id = 'i1'");
    push(phone, desktop);
    push(desktop, phone);
    expect(rows(phone, "SELECT title, done FROM items")).toEqual([{ title: "Incline bench", done: 1 }]);
    expect(rows(desktop, "SELECT title, done FROM items")).toEqual([{ title: "Incline bench", done: 1 }]);

    desktop.exec("UPDATE lists SET name = 'Older' WHERE id = 'l1'");
    phone.exec("UPDATE lists SET name = 'Newer' WHERE id = 'l1'");
    push(desktop, phone);
    push(phone, desktop);
    expect(rows(desktop, "SELECT name FROM lists")).toEqual(rows(phone, "SELECT name FROM lists"));
  });

  it("leaves local columns and local rows on their device", () => {
    const phone = open_device();
    const desktop = open_device();
    phone.exec(`INSERT INTO lists VALUES ('l1', 'Legs'); INSERT INTO items (id, list_id, title, seen_here) VALUES ('i1', 'l1', 'Squat', 7);
      INSERT INTO settings VALUES ('window_size', 'big'), ('units', 'kg')`);
    push(phone, desktop);

    expect(rows(desktop, "SELECT title, seen_here FROM items")).toEqual([{ title: "Squat", seen_here: null }]);
    expect(rows(desktop, "SELECT key FROM settings")).toEqual([{ key: "units" }]);
  });

  it("removes rows left pointing at a row another device deleted", () => {
    const phone = open_device();
    const desktop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Legs')");
    push(phone, desktop);

    desktop.exec("INSERT INTO items (id, list_id, title) VALUES ('i1', 'l1', 'Squat')");
    phone.exec("DELETE FROM lists WHERE id = 'l1'");
    push(phone, desktop);
    expect(rows(desktop, "SELECT * FROM items")).toEqual([]);
  });

  it("counts unpushed rows and rebuilds a device from a snapshot", () => {
    const phone = open_device();
    const desktop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Legs'), ('l2', 'Arms')");
    expect(engine.has_unpushed_changes(phone)).toBe(true);
    expect(engine.count_unpushed_rows(phone)).toBe(2);

    desktop.exec("INSERT INTO lists VALUES ('old', 'Gone soon')");
    engine.replace_with_snapshot(desktop, engine.collect_snapshot(phone).changes);
    expect(rows(desktop, "SELECT id FROM lists ORDER BY id")).toEqual([{ id: "l1" }, { id: "l2" }]);
  });

  it("does not stamp changes it applies from elsewhere as its own", () => {
    const phone = open_device();
    const desktop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Legs')");
    push(phone, desktop);
    expect(engine.has_unpushed_changes(desktop)).toBe(false);
  });
});
