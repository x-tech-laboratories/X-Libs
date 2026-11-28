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

// Sends one device's changes the other has not had and marks them sent, as a peer's exchange does.
function push(from: SqlDatabase, to: SqlDatabase, using = engine): number {
  const receiver = using.read_state(to).site;
  const known = using.read_peer(from, receiver);
  const outgoing = using.collect_changes_since(from, known.sent_seq, receiver);
  using.write_peer(from, receiver, { site: receiver, sent_seq: outgoing.up_to_seq });
  return using.apply_changes(to, outgoing.changes);
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

  it("counts the rows some peer has not had, and none once every peer has them", () => {
    const phone = open_device();
    const desktop = open_device();
    const laptop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Legs'), ('l2', 'Arms')");
    expect(engine.count_unsent_rows(phone, [])).toBe(0);
    expect(engine.has_unsent_changes(phone, engine.read_state(desktop).site)).toBe(true);
    expect(engine.count_unsent_rows(phone, [engine.read_state(desktop).site, engine.read_state(laptop).site])).toBe(2);

    push(phone, desktop);
    expect(engine.count_unsent_rows(phone, [engine.read_state(desktop).site, engine.read_state(laptop).site])).toBe(2);
    push(phone, laptop);
    expect(engine.count_unsent_rows(phone, [engine.read_state(desktop).site, engine.read_state(laptop).site])).toBe(0);
  });

  it("passes on changes it took from one device to the next, but not back to the device that made them", () => {
    const phone = open_device();
    const desktop = open_device();
    const laptop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Legs')");
    push(phone, desktop);
    const phone_site = engine.read_state(phone).site;
    engine.write_peer(desktop, phone_site, { site: phone_site });

    expect(engine.has_unsent_changes(desktop, phone_site)).toBe(false);
    push(desktop, laptop);
    expect(rows(laptop, "SELECT id, name FROM lists")).toEqual([{ id: "l1", name: "Legs" }]);
  });

  it("makes another copy match this one after a restore, removing rows only the other had", () => {
    const phone = open_device();
    const desktop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Legs')");
    push(phone, desktop);
    desktop.exec("UPDATE lists SET name = 'Later' WHERE id = 'l1'; INSERT INTO lists VALUES ('l2', 'Arms')");
    push(desktop, phone);
    phone.exec("UPDATE lists SET name = 'Legs' WHERE id = 'l1'; DELETE FROM lists WHERE id = 'l2'");

    engine.forget_history(phone);
    const desktop_site = engine.read_state(desktop).site;
    expect(engine.needs_claim(phone, desktop_site)).toBe(true);
    engine.claim_everything(phone, engine.collect_snapshot(desktop).changes);
    engine.write_peer(phone, desktop_site, { claimed: engine.read_state(phone).claim_generation, sent_seq: 0 });
    push(phone, desktop);

    expect(engine.needs_claim(phone, desktop_site)).toBe(false);
    expect(rows(desktop, "SELECT id, name FROM lists ORDER BY id")).toEqual([{ id: "l1", name: "Legs" }]);
  });

  it("gives a database first opened by another device fresh ids and forgets its peers", () => {
    const phone = open_device();
    engine.claim_for_device(phone, "PHONE");
    engine.write_peer(phone, "DESKTOP", { sent_seq: 5 });
    const before = engine.read_state(phone);

    engine.claim_for_device(phone, "PHONE");
    expect(engine.read_state(phone).site).toBe(before.site);
    engine.claim_for_device(phone, "COPY");
    expect(engine.read_state(phone).site).not.toBe(before.site);
    expect(engine.read_peer(phone, "DESKTOP").sent_seq).toBe(0);
    engine.remove_peer(phone, "DESKTOP");
  });

  it("adds the peer columns to a database made before peers synced", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), site TEXT NOT NULL, generation TEXT NOT NULL,
      server_generation TEXT NOT NULL DEFAULT '', last_seq INTEGER NOT NULL DEFAULT 0, pushed_seq INTEGER NOT NULL DEFAULT 0,
      pulled_seq INTEGER NOT NULL DEFAULT 0, is_applying INTEGER NOT NULL DEFAULT 0)`);
    migrate(database, ["CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL)", "CREATE TABLE items (id TEXT PRIMARY KEY)", "CREATE TABLE settings (key TEXT PRIMARY KEY)"]);
    engine.install(database);
    expect(engine.read_state(database)).toMatchObject({ device: "", claim_generation: "" });
  });

  it("does not stamp changes it applies from elsewhere as its own", () => {
    const phone = open_device();
    const desktop = open_device();
    phone.exec("INSERT INTO lists VALUES ('l1', 'Legs')");
    push(phone, desktop);
    expect(engine.count_unsent_rows(desktop, ["ANY"])).toBe(0);
  });
});

const map_engine = create_sync_engine({ tables: [{ name: "games", key_columns: ["id"], map_columns: ["other_ids"] }] });
const games_sql = `CREATE TABLE games (id TEXT PRIMARY KEY, title TEXT NOT NULL, other_ids TEXT NOT NULL DEFAULT '{}')`;

function open_map_device(): SqlDatabase {
  const database = new DatabaseSync(":memory:");
  migrate(database, [games_sql]);
  map_engine.install(database);
  return database;
}

function push_map(from: SqlDatabase, to: SqlDatabase): number {
  return push(from, to, map_engine);
}

function other_ids(database: SqlDatabase): unknown {
  return JSON.parse((database.prepare("SELECT other_ids FROM games WHERE id = 'g1'").get() as { other_ids: string }).other_ids);
}

describe("sync engine map columns", () => {
  it("carries a new row with its keys", () => {
    const phone = open_map_device();
    const desktop = open_map_device();
    phone.exec(`INSERT INTO games VALUES ('g1', 'Ori', '{"shelfdb":"7"}')`);
    push_map(phone, desktop);
    expect(other_ids(desktop)).toEqual({ shelfdb: "7" });
  });

  it("keeps keys two devices added to the same value at once", () => {
    const phone = open_map_device();
    const desktop = open_map_device();
    phone.exec("INSERT INTO games (id, title) VALUES ('g1', 'Ori')");
    push_map(phone, desktop);

    phone.exec(`UPDATE games SET other_ids = '{"shelfdb":"7"}'`);
    desktop.exec(`UPDATE games SET other_ids = '{"gamedb":"x1"}'`);
    push_map(phone, desktop);
    push_map(desktop, phone);
    expect(other_ids(phone)).toEqual({ shelfdb: "7", gamedb: "x1" });
    expect(other_ids(desktop)).toEqual({ shelfdb: "7", gamedb: "x1" });
  });

  it("carries a removed key, and the later write of the same key", async () => {
    const phone = open_map_device();
    const desktop = open_map_device();
    phone.exec(`INSERT INTO games VALUES ('g1', 'Ori', '{"shelfdb":"7","gamedb":"x1"}')`);
    push_map(phone, desktop);

    desktop.exec(`UPDATE games SET other_ids = '{"shelfdb":"8","gamedb":"x1"}'`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    phone.exec(`UPDATE games SET other_ids = '{"shelfdb":"9"}'`);
    push_map(phone, desktop);
    push_map(desktop, phone);
    expect(other_ids(desktop)).toEqual({ shelfdb: "9" });
    expect(other_ids(phone)).toEqual({ shelfdb: "9" });
  });

  it("removes a key only the other copy had when this copy claims it", () => {
    const phone = open_map_device();
    const desktop = open_map_device();
    phone.exec(`INSERT INTO games VALUES ('g1', 'Ori', '{"shelfdb":"7"}')`);
    push_map(phone, desktop);
    desktop.exec(`UPDATE games SET other_ids = '{"shelfdb":"7","gamedb":"x1"}'`);

    map_engine.claim_everything(phone, map_engine.collect_snapshot(desktop).changes);
    push_map(phone, desktop);
    expect(other_ids(desktop)).toEqual({ shelfdb: "7" });
  });

  it("gives each key of a column that became a map column the version the whole value had", () => {
    const whole_engine = create_sync_engine({ tables: [{ name: "games", key_columns: ["id"] }] });
    const phone = new DatabaseSync(":memory:");
    migrate(phone, [games_sql]);
    whole_engine.install(phone);
    phone.exec(`INSERT INTO games VALUES ('g1', 'Ori', '{"shelfdb":"7"}')`);

    map_engine.install(phone);
    const cells = phone.prepare("SELECT column_name FROM sync_cells WHERE column_name LIKE 'other_ids%'").all().map((row) => (row as { column_name: string }).column_name);
    expect(cells).toEqual(["other_ids:shelfdb"]);
    const desktop = open_map_device();
    push_map(phone, desktop);
    expect(other_ids(desktop)).toEqual({ shelfdb: "7" });
  });
});
