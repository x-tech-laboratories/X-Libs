// A history of every change to an app's items, such as tasks or workouts, kept in SQLite beside them: triggers note
// each item a write touches, however it was made, and record saves one version of each, so any version can be
// restored and a deleted item brought back. The versions table syncs like any other.

import type { SqlDatabase } from "./sql.ts";
import type { SyncedTable } from "./sync_engine.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// A table whose writes change an item, and the columns naming the item on each row: one for the item's own table,
// one for a child table such as its tags, two for a link between two items.
export interface HistoryWatch {
  table: string;
  item_columns: readonly string[];
}

export interface HistoryOptions<Snapshot> {
  // Names the tables, such as "task" for task_versions and task_versions_pending.
  name: string;
  // The items' own table and its key column; items still there keep their newest version when older ones are pruned.
  item_table: string;
  item_key?: string;
  // The column naming the item in the versions and pending tables; "item_id" unless set, such as an app's own older table.
  item_column?: string;
  // Every table whose writes change an item, the item table included.
  watches: readonly HistoryWatch[];
  // The item as it is now, or null once it is gone.
  read: (database: SqlDatabase, item_id: string) => Snapshot | null;
  // Puts the item back as the snapshot has it, adding it if it is gone.
  apply: (database: SqlDatabase, item_id: string, snapshot: Snapshot) => void;
  // Whether two snapshots are the same item state; the same JSON unless set.
  is_same?: (first: Snapshot, second: Snapshot) => boolean;
  // When an item was made, for the first version of one that was there before history was; now unless set.
  created_at?: (snapshot: Snapshot) => string;
  // The item a snapshot sits under, so items deleted together with it come back with it.
  parent_of?: (snapshot: Snapshot) => string | null;
  // This device's id, so versions say whether they were made here; the sync engine's site unless set.
  site?: (database: SqlDatabase) => string;
}

export type VersionKind = "first_seen" | "created" | "edited" | "deleted" | "restored";

export interface Version<Snapshot> {
  // The same on every device.
  id: string;
  item_id: string;
  changed_at: string;
  kind: VersionKind;
  origin: "here" | "elsewhere";
  // The version a restore came back from.
  restored_from: string | null;
  snapshot: Snapshot;
  // The version before it, for showing what changed; null for the first.
  previous: Snapshot | null;
}

interface VersionRow {
  uid: string;
  item_id: string;
  changed_at: string;
  kind: VersionKind;
  site: string;
  restored_from: string | null;
  snapshot: string;
  previous: string | null;
}

// Versions run in the order they were made, whichever device made them and whenever they arrived.
const newest_first = "ORDER BY changed_at DESC, id DESC";

function sync_site(database: SqlDatabase): string {
  try {
    return (database.prepare("SELECT site FROM sync_state").get() as { site: string } | undefined)?.site ?? "";
  } catch {
    return "";
  }
}

export type History<Snapshot> = ReturnType<typeof create_history<Snapshot>>;

// ── History ──────────────────────────────────────────────────────────────────

export function create_history<Snapshot>(options: HistoryOptions<Snapshot>) {
  const { name, item_table, read, apply } = options;
  const item_key = options.item_key ?? "id";
  const item_column = options.item_column ?? "item_id";
  const versions = `${name}_versions`;
  const pending = `${name}_versions_pending`;
  const is_same = options.is_same ?? ((first: Snapshot, second: Snapshot) => JSON.stringify(first) === JSON.stringify(second));
  const site_of = options.site ?? sync_site;

  // Made only where missing, so an app whose versions tables already exist under these names keeps them as they are.
  const schema = `CREATE TABLE IF NOT EXISTS ${versions} (
       id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, ${item_column} TEXT NOT NULL, changed_at TEXT NOT NULL, kind TEXT NOT NULL,
       site TEXT NOT NULL DEFAULT '', restored_from TEXT, snapshot TEXT NOT NULL
     );
     CREATE INDEX IF NOT EXISTS ${versions}_by_item ON ${versions} (${item_column}, changed_at);
     CREATE INDEX IF NOT EXISTS ${versions}_by_time ON ${versions} (changed_at);
     CREATE TABLE IF NOT EXISTS ${pending} (${item_column} TEXT PRIMARY KEY) WITHOUT ROWID`;

  // For the sync engine's tables, so every device has every version.
  const synced_table: SyncedTable = { name: versions, key_columns: ["uid"], local_columns: ["id"] };

  // ── Triggers ─────────────────────────────────────────────────────────────

  const triggers = options.watches.flatMap((watch) =>
    (["insert", "update", "delete"] as const).map((event) => {
      const row = event === "delete" ? "OLD" : "NEW";
      const notes = watch.item_columns.map((column) => `INSERT OR IGNORE INTO ${pending} SELECT ${row}.${column} WHERE ${row}.${column} IS NOT NULL;`).join(" ");
      return { name: `${versions}_${watch.table}_${event}`, sql: `AFTER ${event.toUpperCase()} ON ${watch.table} BEGIN ${notes} END` };
    }),
  );

  function drop_triggers(database: SqlDatabase): void {
    for (const trigger of triggers) database.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
  }

  // Run each time the database opens: makes the tables, sets the triggers, and gives every item with no history yet
  // a first version as it stands now, with an id every device gives it alike.
  function install(database: SqlDatabase): void {
    database.exec(schema);
    drop_triggers(database);
    for (const trigger of triggers) database.exec(`CREATE TRIGGER ${trigger.name} ${trigger.sql}`);

    const unseen = database.prepare(`SELECT ${item_key} AS id FROM ${item_table} WHERE ${item_key} NOT IN (SELECT ${item_column} FROM ${versions})`).all() as { id: string }[];
    const site = site_of(database);
    for (const { id } of unseen) {
      const snapshot = read(database, String(id));
      if (!snapshot) continue;
      insert(database, `first_seen:${id}`, String(id), options.created_at?.(snapshot) ?? new Date().toISOString(), "first_seen", site, null, snapshot);
    }
  }

  // Writes that arrive by sync touch items too, but their versions come from the device that made them; pass it as the
  // sync engine's after_apply.
  function forget_touched(database: SqlDatabase): void {
    database.exec(`DELETE FROM ${pending}`);
  }

  // ── Recording ────────────────────────────────────────────────────────────

  function insert(database: SqlDatabase, uid: string, item_id: string, changed_at: string, kind: VersionKind, site: string, restored_from: string | null, snapshot: Snapshot): void {
    database
      .prepare(`INSERT OR IGNORE INTO ${versions} (uid, ${item_column}, changed_at, kind, site, restored_from, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(uid, item_id, changed_at, kind, site, restored_from, JSON.stringify(snapshot));
  }

  function latest(database: SqlDatabase, item_id: string): { kind: VersionKind; snapshot: Snapshot } | null {
    const row = database.prepare(`SELECT kind, snapshot FROM ${versions} WHERE ${item_column} = ? ${newest_first} LIMIT 1`).get(item_id) as { kind: VersionKind; snapshot: string } | undefined;
    return row ? { kind: row.kind, snapshot: JSON.parse(row.snapshot) as Snapshot } : null;
  }

  // Saves a version of each item touched since the last call, skipping any that ended up as they were; call it after
  // each write. A restore passes the version each item came back from.
  function record(database: SqlDatabase, restored_from = new Map<string, string>()): void {
    const touched = database.prepare(`SELECT ${item_column} AS item_id FROM ${pending}`).all() as { item_id: string }[];
    if (touched.length === 0) return;
    const changed_at = new Date().toISOString();
    const site = site_of(database);

    for (const { item_id } of touched) {
      const current = read(database, item_id);
      const before = latest(database, item_id);
      const restored_uid = restored_from.get(item_id) ?? null;
      const was_deleted = before?.kind === "deleted";
      const uid = crypto.randomUUID();

      if (!current) {
        if (before && !was_deleted) insert(database, uid, item_id, changed_at, "deleted", site, null, before.snapshot);
      } else if (!before) {
        insert(database, uid, item_id, changed_at, "created", site, null, current);
      } else if (was_deleted || restored_uid !== null || !is_same(before.snapshot, current)) {
        insert(database, uid, item_id, changed_at, was_deleted || restored_uid !== null ? "restored" : "edited", site, restored_uid, current);
      }
    }
    forget_touched(database);
  }

  // Versions made before the cutoff go, except the newest of each item still there, which later changes are compared against.
  function prune(database: SqlDatabase, cutoff: string): void {
    database
      .prepare(
        `DELETE FROM ${versions} WHERE changed_at < ? AND id NOT IN (
           SELECT id FROM (SELECT id, ${item_column} AS item_id, ROW_NUMBER() OVER (PARTITION BY ${item_column} ${newest_first}) AS rank FROM ${versions})
           WHERE rank = 1 AND item_id IN (SELECT ${item_key} FROM ${item_table})
         )`,
      )
      .run(cutoff);
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  const columns = `id, uid, ${item_column} AS item_id, changed_at, kind, site, restored_from, snapshot,
    LAG(snapshot) OVER (PARTITION BY ${item_column} ORDER BY changed_at, id) AS previous`;

  function to_versions(database: SqlDatabase, rows: unknown[]): Version<Snapshot>[] {
    const site = site_of(database);
    return (rows as VersionRow[]).map((row) => ({
      id: row.uid,
      item_id: row.item_id,
      changed_at: row.changed_at,
      kind: row.kind,
      origin: row.site === site ? "here" : "elsewhere",
      restored_from: row.restored_from,
      snapshot: JSON.parse(row.snapshot) as Snapshot,
      previous: row.previous === null ? null : (JSON.parse(row.previous) as Snapshot),
    }));
  }

  // One item's versions, newest first.
  function read_versions(database: SqlDatabase, item_id: string): Version<Snapshot>[] {
    return to_versions(database, database.prepare(`SELECT ${columns} FROM ${versions} WHERE ${item_column} = ? ${newest_first}`).all(item_id));
  }

  // The latest versions of every item, deleted ones included, newest first.
  function read_recent(database: SqlDatabase, limit: number): Version<Snapshot>[] {
    return to_versions(database, database.prepare(`SELECT * FROM (SELECT ${columns} FROM ${versions}) ${newest_first} LIMIT ?`).all(limit));
  }

  // ── Restoring ────────────────────────────────────────────────────────────

  const exists = (database: SqlDatabase, item_id: string) => database.prepare(`SELECT 1 FROM ${item_table} WHERE ${item_key} = ?`).get(item_id) !== undefined;

  // Brings an item back to one of its versions and records it; a deleted item comes back with the items deleted along
  // with it under it, while they are still gone.
  function restore(database: SqlDatabase, version_id: string): void {
    const row = database.prepare(`SELECT uid, ${item_column} AS item_id, snapshot FROM ${versions} WHERE uid = ?`).get(version_id) as Pick<VersionRow, "uid" | "item_id" | "snapshot"> | undefined;
    if (!row) throw new Error(`no such version: ${version_id}`);
    const restored_from = new Map<string, string>();
    const was_gone = !exists(database, row.item_id);

    apply(database, row.item_id, JSON.parse(row.snapshot) as Snapshot);
    restored_from.set(row.item_id, row.uid);

    const { parent_of } = options;
    if (was_gone && parent_of) {
      const deleted_together = database
        .prepare(
          `SELECT uid, ${item_column} AS item_id, snapshot FROM ${versions} AS version
           WHERE kind = 'deleted'
             AND changed_at = (SELECT changed_at FROM ${versions} WHERE ${item_column} = ? AND kind = 'deleted' ${newest_first} LIMIT 1)
             AND uid = (SELECT uid FROM ${versions} WHERE ${item_column} = version.${item_column} ${newest_first} LIMIT 1)`,
        )
        .all(row.item_id) as Pick<VersionRow, "uid" | "item_id" | "snapshot">[];
      const waiting = deleted_together.map((each) => ({ ...each, snapshot: JSON.parse(each.snapshot) as Snapshot }));

      for (let parent_ids = [row.item_id]; parent_ids.length > 0; ) {
        const children = waiting.filter((each) => {
          const parent_id = parent_of(each.snapshot);
          return parent_id !== null && parent_ids.includes(parent_id) && !exists(database, each.item_id);
        });
        for (const child of children) {
          apply(database, child.item_id, child.snapshot);
          restored_from.set(child.item_id, child.uid);
        }
        parent_ids = children.map((child) => child.item_id);
      }
    }
    record(database, restored_from);
  }

  return { schema, synced_table, install, drop_triggers, forget_touched, record, prune, read_versions, read_recent, restore };
}

// ── Device calls ─────────────────────────────────────────────────────────────

// What a page asks of whatever keeps the history.
export interface HistoryMethods<Snapshot> {
  list_versions: (item_id: string) => Version<Snapshot>[];
  list_recent_versions: (limit: number) => Version<Snapshot>[];
  restore_version: (version_id: string) => void;
}

export const history_method_names = ["list_versions", "list_recent_versions", "restore_version"] as const;

// The calls answered on a database, for an app's method table.
export function history_methods<Snapshot>(history: History<Snapshot>, database: () => SqlDatabase): HistoryMethods<Snapshot> {
  return {
    list_versions: (item_id) => history.read_versions(database(), item_id),
    list_recent_versions: (limit) => history.read_recent(database(), limit),
    restore_version: (version_id) => history.restore(database(), version_id),
  };
}
