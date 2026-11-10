// Typed SQLite on Drizzle ORM, over any SqlDatabase, so the same queries run on node:sqlite on a server or desktop and on
// SQLite in WebAssembly in a phone's page. Drizzle was chosen over Kysely and hand-written SQL because it types rows from
// one schema written in TypeScript, writes the migration SQL from that schema with drizzle-kit, and runs synchronously,
// as the stores and sync here do. It is pinned to 1.0.0-rc.5, the first line with a node:sqlite session.
// X-Libs adds: the connection over SqlDatabase without node:sqlite's own driver, which a page cannot load; the sync list
// read from the schema's primary keys; and migrations kept per owner through `sql`'s migrate.

// ── Imports ──────────────────────────────────────────────────────────────────

import { nodeSQLiteCodecs } from "drizzle-orm/node-sqlite/codecs";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite/driver";
import { NodeSQLiteSession } from "drizzle-orm/node-sqlite/session";
import { getTableConfig, SQLiteAsyncDatabase, SQLiteDialect, type SQLiteTable } from "drizzle-orm/sqlite-core";

import { migrate, type SqlDatabase } from "./sql.ts";
import type { SyncedTable } from "./sync_engine.ts";

// ── The schema's builders and query operators ────────────────────────────────

// An app builds its schema and queries from here and never imports Drizzle itself.
export {
  blob,
  check,
  foreignKey,
  getTableConfig,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";
export {
  and,
  asc,
  avg,
  between,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notInArray,
  or,
  sql,
  sum,
  type InferInsertModel,
  type InferSelectModel,
} from "drizzle-orm";

// ── Connection ───────────────────────────────────────────────────────────────

export type Drizzle = NodeSQLiteDatabase;

// Queries run synchronously on the connection given, so they share its transactions and its sync triggers.
export function open_drizzle(database: SqlDatabase): Drizzle {
  const dialect = new SQLiteDialect({ codecs: nodeSQLiteCodecs });
  const client = database as unknown as ConstructorParameters<typeof NodeSQLiteSession>[0];
  const session = new NodeSQLiteSession(client, dialect, {});
  return new SQLiteAsyncDatabase("sync", dialect, session as unknown as ConstructorParameters<typeof SQLiteAsyncDatabase>[2], {}) as unknown as Drizzle;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  // Columns kept only on this device, by table name.
  local_columns?: Record<string, string[]>;
  // Rows kept only on this device, by table name and key.
  local_keys?: Record<string, readonly string[]>;
}

// The sync list for the tables given, parents first, each named by its primary key.
export function synced_tables(tables: readonly SQLiteTable[], options: SyncOptions = {}): SyncedTable[] {
  return tables.map((table) => {
    const config = getTableConfig(table);
    const composite = config.primaryKeys[0]?.columns.map((column) => column.name);
    const key_columns = composite ?? config.columns.filter((column) => column.primary).map((column) => column.name);
    if (key_columns.length === 0) throw new Error(`table ${config.name} has no primary key to sync by`);
    return { name: config.name, key_columns, local_columns: options.local_columns?.[config.name], local_keys: options.local_keys?.[config.name] };
  });
}

// ── Migrations ───────────────────────────────────────────────────────────────

// One migration drizzle-kit wrote, as `drizzle_migrations` bundles it.
export interface DrizzleMigration {
  name: string;
  statements: string[];
}

// Runs the owner's migrations not yet run, in their order, each once.
export function migrate_drizzle(database: SqlDatabase, owner: string, migrations: readonly DrizzleMigration[]): void {
  migrate(
    database,
    migrations.map((migration) => migration.statements),
    { owner },
  );
}
