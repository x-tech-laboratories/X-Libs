import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { asc, eq, migrate_drizzle, open_drizzle, primaryKey, real, sqliteTable, synced_tables, text, type DrizzleMigration } from "../src/drizzle.ts";
import { bundle_migrations, read_migrations } from "../src/drizzle_migrations.ts";
import { migrate, type SqlDatabase } from "../src/sql.ts";
import { create_sync_engine } from "../src/sync_engine.ts";
import { open_wasm_database, type FileStore } from "../src/web/sqlite_wasm.ts";

const metrics = sqliteTable("metrics", { id: text().primaryKey(), name: text().notNull() });
const readings = sqliteTable(
  "readings",
  { metric_id: text().notNull().references(() => metrics.id, { onDelete: "cascade" }), day: text().notNull(), value: real().notNull() },
  (table) => [primaryKey({ columns: [table.metric_id, table.day] })],
);
const notes = sqliteTable("notes", { text: text() });

// What drizzle-kit writes for the two tables, one statement per breakpoint.
const start_migration: DrizzleMigration = {
  name: "20261110000000_start",
  statements: [
    "CREATE TABLE `metrics` (`id` text PRIMARY KEY, `name` text NOT NULL)",
    "CREATE TABLE `readings` (`metric_id` text NOT NULL, `day` text NOT NULL, `value` real NOT NULL, CONSTRAINT `readings_pk` PRIMARY KEY(`metric_id`, `day`), FOREIGN KEY (`metric_id`) REFERENCES `metrics`(`id`) ON DELETE CASCADE)",
  ],
};

function memory_files(): FileStore & { saved: Map<string, Uint8Array> } {
  const saved = new Map<string, Uint8Array>();
  return { saved, read: async (name) => saved.get(name), write: async (name, bytes) => void saved.set(name, bytes) };
}

async function exercise(database: SqlDatabase): Promise<void> {
  migrate_drizzle(database, "body", [start_migration]);
  const db = open_drizzle(database);

  const [added] = db.insert(metrics).values({ id: "weight", name: "Weight" }).returning().all();
  expect(added).toEqual({ id: "weight", name: "Weight" });
  db.insert(readings).values([{ metric_id: "weight", day: "2026-11-02", value: 80.5 }, { metric_id: "weight", day: "2026-11-01", value: 81 }]).run();

  const rows = db.select({ day: readings.day, value: readings.value }).from(readings).where(eq(readings.metric_id, "weight")).orderBy(asc(readings.day)).all();
  expect(rows).toEqual([{ day: "2026-11-01", value: 81 }, { day: "2026-11-02", value: 80.5 }]);

  db.transaction((transaction) => {
    transaction.update(metrics).set({ name: "Body weight" }).where(eq(metrics.id, "weight")).run();
  });
  expect(db.select().from(metrics).get()).toEqual({ id: "weight", name: "Body weight" });
}

describe("drizzle", () => {
  it("migrates and runs typed queries on node:sqlite", async () => {
    await exercise(new DatabaseSync(":memory:"));
  });

  it("runs the same queries on SQLite in WebAssembly, saving after a write that returns rows", async () => {
    const files = memory_files();
    const database = await open_wasm_database({ files, file_name: "test.db", save_delay_ms: 0 });
    await exercise(database.connection);
    await database.save_now();
    expect(files.saved.get("test.db")?.byteLength).toBeGreaterThan(0);
  });

  it("lets sync stamp the writes Drizzle makes", () => {
    const database = new DatabaseSync(":memory:");
    migrate_drizzle(database, "body", [start_migration]);
    const engine = create_sync_engine({ tables: synced_tables([metrics, readings]) });
    engine.install(database);

    open_drizzle(database).insert(metrics).values({ id: "waist", name: "Waist" }).run();
    expect(engine.collect_unpushed_changes(database).changes.map((change) => change.column).sort()).toEqual(["_exists", "id", "name"]);
  });

  it("reads each table's sync key from its primary key and refuses a table without one", () => {
    expect(synced_tables([metrics, readings], { local_columns: { readings: ["value"] } })).toEqual([
      { name: "metrics", key_columns: ["id"], local_columns: undefined, local_keys: undefined },
      { name: "readings", key_columns: ["metric_id", "day"], local_columns: ["value"], local_keys: undefined },
    ]);
    expect(() => synced_tables([notes])).toThrow("table notes has no primary key to sync by");
  });
});

describe("migrate", () => {
  it("keeps each owner's version apart and runs each step once", () => {
    const database = new DatabaseSync(":memory:");
    migrate(database, ["CREATE TABLE a (id TEXT)"], { owner: "first" });
    migrate(database, ["CREATE TABLE b (id TEXT)", ["CREATE TABLE c (id TEXT)", "CREATE TABLE d (id TEXT)"]], { owner: "second" });
    migrate(database, ["CREATE TABLE a (id TEXT)", "CREATE TABLE e (id TEXT)"], { owner: "first" });

    const versions = database.prepare("SELECT owner, version FROM schema_versions ORDER BY owner").all().map((row) => ({ ...row }));
    expect(versions).toEqual([{ owner: "first", version: 2 }, { owner: "second", version: 2 }]);
    expect(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('a', 'b', 'c', 'd', 'e')").get()).toEqual({ count: 5 });
  });

  it("rolls a failing step back and keeps its version", () => {
    const database = new DatabaseSync(":memory:");
    expect(() => migrate(database, [["CREATE TABLE a (id TEXT)", "NOT SQL"]], { owner: "broken" })).toThrow();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get()).toBeUndefined();
    expect(database.prepare("SELECT version FROM schema_versions WHERE owner = 'broken'").get()).toBeUndefined();
  });
});

describe("bundle migrations", () => {
  it("reads drizzle-kit's folders oldest first, split at its breakpoints, into an index.ts", () => {
    const folder = mkdtempSync(join(tmpdir(), "x-libs-migrations-"));
    for (const [name, sql] of [
      ["20261111000000_more", "CREATE TABLE b (id text);"],
      ["20261110000000_start", "CREATE TABLE a (id text);\n--> statement-breakpoint\nCREATE INDEX a_id ON a (id);\n"],
    ]) {
      mkdirSync(join(folder, name!));
      writeFileSync(join(folder, name!, "migration.sql"), sql!);
    }

    expect(read_migrations(folder)).toEqual([
      { name: "20261110000000_start", statements: ["CREATE TABLE a (id text);", "CREATE INDEX a_id ON a (id);"] },
      { name: "20261111000000_more", statements: ["CREATE TABLE b (id text);"] },
    ]);
    const written = readFileSync(bundle_migrations(folder), "utf8");
    expect(written).toContain('export const migrations: DrizzleMigration[] = [');
    expect(written).toContain('"20261111000000_more"');
  });
});
