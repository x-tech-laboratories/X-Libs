// Keeps an app's SQLite tables alike on every device. Every value sync tracks is a cell, one column of one row, holding the
// time it was last written and the device that wrote it; the newest write of each cell wins on every device, and a row's
// presence is a cell of its own. A map column, a JSON object, keeps a cell for each of its keys instead, so two devices
// writing different keys of it keep both. Triggers stamp the app's own writes, whatever code makes them, so the app's store code
// needs no changes to sync.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { SqlDatabase, SqlValue } from "./sql.ts";
import type { SyncChange } from "./sync_protocol.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface SyncedTable {
  name: string;
  // The columns whose values, joined with '/', name a row the same way on every device.
  key_columns: string[];
  // Columns kept only on this device, such as a local row number.
  local_columns?: string[];
  // Rows kept only on this device, by key, such as a setting for this device alone.
  local_keys?: readonly string[];
  // JSON object columns whose keys sync one by one, so two devices adding different keys keep both; a removed key is null.
  map_columns?: string[];
}

export interface SyncEngineOptions {
  // Parents before children, so a batch adds a row before the rows that point at it.
  tables: SyncedTable[];
  // Runs inside the transaction that applied changes from elsewhere, before it commits.
  after_apply?: (database: SqlDatabase) => void;
}

export interface SyncStateRow {
  // This device's id, stamped on every change it makes.
  site: string;
  // The id of the data this database serves, when it is the server.
  generation: string;
  // The server data this device follows, or empty when it follows none.
  server_generation: string;
  last_seq: number;
  // This device's own changes up to here have reached the server.
  pushed_seq: number;
  // The server's changes up to here have reached this device.
  pulled_seq: number;
}

export interface CollectedChanges {
  changes: SyncChange[];
  up_to_seq: number;
}

export type SyncEngine = ReturnType<typeof create_sync_engine>;

// ── Schema ───────────────────────────────────────────────────────────────────

const exists_column = "_exists";
const now_ms = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`;
const trigger_events = ["insert", "update", "delete"] as const;
// Joins a map column's name to one of its keys to name that key's cell.
const map_separator = ":";

// A map column's value as an object; anything that is not one is empty.
function object_of(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  } catch {
    return {};
  }
}

// Safe to run on every start; a new database gets fresh device and data ids.
export const sync_schema_sql = `
  CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    site TEXT NOT NULL,
    generation TEXT NOT NULL,
    server_generation TEXT NOT NULL DEFAULT '',
    last_seq INTEGER NOT NULL DEFAULT 0,
    pushed_seq INTEGER NOT NULL DEFAULT 0,
    pulled_seq INTEGER NOT NULL DEFAULT 0,
    is_applying INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO sync_state (id, site, generation) VALUES (1, lower(hex(randomblob(16))), lower(hex(randomblob(16))));
  CREATE TABLE IF NOT EXISTS sync_cells (
    table_name TEXT NOT NULL,
    row_key TEXT NOT NULL,
    column_name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    site TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (table_name, row_key, column_name)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS sync_cells_by_seq ON sync_cells (seq);`;

interface CellRow {
  table_name: string;
  row_key: string;
  column_name: string;
  ts: number;
  site: string;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export function create_sync_engine(options: SyncEngineOptions) {
  const tables = options.tables.map((table) => ({ ...table, local_columns: table.local_columns ?? [], local_keys: table.local_keys ?? [], map_columns: table.map_columns ?? [] }));
  const tables_by_name = new Map(tables.map((table) => [table.name, table]));
  type Table = (typeof tables)[number];
  interface KnownColumns {
    columns: string[];
    map_columns: string[];
  }

  // The map column and key a cell names, or null for a cell of a whole value.
  function split_map_cell(table: Table, cell_name: string): { column: string; key: string } | null {
    const at = cell_name.indexOf(map_separator);
    if (at < 0 || !table.map_columns.includes(cell_name.slice(0, at))) return null;
    return { column: cell_name.slice(0, at), key: cell_name.slice(at + map_separator.length) };
  }

  function key_sql(table: Table, alias: string): string {
    return table.key_columns.map((column) => `${alias}."${column}"`).join(` || '/' || `);
  }

  // The condition a row must meet to sync, written against the given row alias.
  function filter_sql(table: Table, alias: string): string {
    if (table.local_keys.length === 0) return "1";
    return `${key_sql(table, alias)} NOT IN (${table.local_keys.map((key) => `'${key.replaceAll("'", "''")}'`).join(", ")})`;
  }

  function column_names(database: SqlDatabase, table: Table): string[] {
    return (database.prepare(`PRAGMA table_info("${table.name}")`).all() as { name: string }[]).map((column) => column.name);
  }

  // The columns that sync as one value each.
  function synced_columns(database: SqlDatabase, table: Table): string[] {
    return column_names(database, table).filter((name) => !table.local_columns.includes(name) && !table.map_columns.includes(name));
  }

  // The map columns the table has, each of whose keys syncs as a value of its own.
  function synced_map_columns(database: SqlDatabase, table: Table): string[] {
    const names = column_names(database, table);
    return table.map_columns.filter((name) => names.includes(name) && !table.local_columns.includes(name));
  }

  // ── Triggers ─────────────────────────────────────────────────────────────

  function trigger_name(table: Table, event: (typeof trigger_events)[number]): string {
    return `sync_${table.name}_${event}`;
  }

  // A local write is stamped with the current time, or just after the cell's last version when this clock is behind it.
  function stamp_cell_sql(table: Table, row_key: string, column: string, condition = "1"): string {
    const cell = `table_name = '${table.name}' AND row_key = ${row_key} AND column_name = '${column}'`;
    return `UPDATE sync_state SET last_seq = last_seq + 1 WHERE ${condition};
      INSERT INTO sync_cells (table_name, row_key, column_name, ts, site, seq)
        SELECT '${table.name}', ${row_key}, '${column}',
          max(${now_ms}, coalesce((SELECT ts + 1 FROM sync_cells WHERE ${cell}), 0)),
          (SELECT site FROM sync_state), (SELECT last_seq FROM sync_state)
        WHERE ${condition}
      ON CONFLICT (table_name, row_key, column_name) DO UPDATE SET ts = excluded.ts, site = excluded.site, seq = excluded.seq;`;
  }

  // A map column's value as an object SQLite can walk; anything else counts as empty.
  function object_sql(value: string): string {
    return `(CASE WHEN json_valid(${value}) THEN (CASE WHEN json_type(${value}) = 'object' THEN ${value} ELSE '{}' END) ELSE '{}' END)`;
  }

  // Stamps a cell for each key the select names, in a column called key, as stamp_cell_sql does for one.
  function stamp_map_sql(table: Table, row_key: string, column: string, keys_select: string): string {
    const cell_name = `'${column}' || '${map_separator}' || changed.key`;
    return `UPDATE sync_state SET last_seq = last_seq + 1 WHERE EXISTS (${keys_select});
      INSERT INTO sync_cells (table_name, row_key, column_name, ts, site, seq)
        SELECT '${table.name}', ${row_key}, ${cell_name},
          max(${now_ms}, coalesce((SELECT ts + 1 FROM sync_cells WHERE table_name = '${table.name}' AND row_key = ${row_key} AND column_name = ${cell_name}), 0)),
          (SELECT site FROM sync_state), (SELECT last_seq FROM sync_state)
        FROM (${keys_select}) AS changed WHERE 1
      ON CONFLICT (table_name, row_key, column_name) DO UPDATE SET ts = excluded.ts, site = excluded.site, seq = excluded.seq;`;
  }

  // The keys of a map column an update added, changed or removed.
  function changed_keys_sql(column: string): string {
    const old_object = object_sql(`OLD."${column}"`);
    const new_object = object_sql(`NEW."${column}"`);
    return `SELECT now.key AS key FROM json_each(${new_object}) AS now
        WHERE now.value IS NOT (SELECT was.value FROM json_each(${old_object}) AS was WHERE was.key = now.key)
      UNION SELECT was.key AS key FROM json_each(${old_object}) AS was
        WHERE NOT EXISTS (SELECT 1 FROM json_each(${new_object}) AS now WHERE now.key = was.key)`;
  }

  function drop_triggers(database: SqlDatabase): void {
    for (const table of tables) for (const event of trigger_events) database.exec(`DROP TRIGGER IF EXISTS ${trigger_name(table, event)}`);
  }

  // Run after every schema change, since the triggers name each column.
  function install(database: SqlDatabase): void {
    database.exec(sync_schema_sql);
    drop_triggers(database);
    const is_local = "(SELECT is_applying FROM sync_state) = 0";

    for (const table of tables) {
      const columns = synced_columns(database, table);
      const map_columns = synced_map_columns(database, table);
      const new_key = key_sql(table, "NEW");
      const old_key = key_sql(table, "OLD");

      database.exec(`CREATE TRIGGER ${trigger_name(table, "insert")} AFTER INSERT ON "${table.name}"
        WHEN ${is_local} AND ${filter_sql(table, "NEW")}
        BEGIN ${[
          ...[exists_column, ...columns].map((column) => stamp_cell_sql(table, new_key, column)),
          ...map_columns.map((column) => stamp_map_sql(table, new_key, column, `SELECT key FROM json_each(${object_sql(`NEW."${column}"`)})`)),
        ].join("\n")} END`);

      const update_steps = [
        ...columns.map((column) => stamp_cell_sql(table, new_key, column, `OLD."${column}" IS NOT NEW."${column}"`)),
        ...map_columns.map((column) => stamp_map_sql(table, new_key, column, changed_keys_sql(column))),
      ];
      database.exec(`CREATE TRIGGER ${trigger_name(table, "update")} AFTER UPDATE ON "${table.name}"
        WHEN ${is_local} AND ${filter_sql(table, "NEW")}
        BEGIN ${update_steps.join("\n")} END`);

      database.exec(`CREATE TRIGGER ${trigger_name(table, "delete")} AFTER DELETE ON "${table.name}"
        WHEN ${is_local} AND ${filter_sql(table, "OLD")}
        BEGIN ${stamp_cell_sql(table, old_key, exists_column)} END`);
    }

    backfill_cells(database);
  }

  // Rows written before sync existed, and columns added since, get a version older than any real write.
  function backfill_cells(database: SqlDatabase): void {
    for (const table of tables) {
      for (const column of [exists_column, ...synced_columns(database, table)]) {
        database
          .prepare(
            `INSERT OR IGNORE INTO sync_cells (table_name, row_key, column_name, ts, site, seq)
             SELECT '${table.name}', ${key_sql(table, "row")}, '${column}', 0, '', 0 FROM "${table.name}" AS row WHERE ${filter_sql(table, "row")}`,
          )
          .run();
      }
      // A column that has just become a map column gives each of its keys the version the whole value had.
      for (const column of synced_map_columns(database, table)) {
        const row_key = key_sql(table, "row");
        database
          .prepare(
            `INSERT OR IGNORE INTO sync_cells (table_name, row_key, column_name, ts, site, seq)
             SELECT '${table.name}', ${row_key}, '${column}${map_separator}' || entry.key, coalesce(whole.ts, 0), coalesce(whole.site, ''), coalesce(whole.seq, 0)
             FROM "${table.name}" AS row
               JOIN json_each(${object_sql(`row."${column}"`)}) AS entry
               LEFT JOIN sync_cells AS whole ON whole.table_name = '${table.name}' AND whole.row_key = ${row_key} AND whole.column_name = '${column}'
             WHERE ${filter_sql(table, "row")}`,
          )
          .run();
        database.prepare("DELETE FROM sync_cells WHERE table_name = ? AND column_name = ?").run(table.name, column);
      }
    }
  }

  // Rows a table held before it synced are sent as this device's own changes, so the server and other devices get them too.
  function stamp_existing_rows(database: SqlDatabase, table_name: string): void {
    database.exec("UPDATE sync_state SET last_seq = last_seq + 1");
    database
      .prepare(`UPDATE sync_cells SET ts = ${now_ms}, site = (SELECT site FROM sync_state), seq = (SELECT last_seq FROM sync_state) WHERE table_name = ? AND site = ''`)
      .run(table_name);
  }

  // ── State ────────────────────────────────────────────────────────────────

  function read_state(database: SqlDatabase): SyncStateRow {
    return database.prepare("SELECT site, generation, server_generation, last_seq, pushed_seq, pulled_seq FROM sync_state").get() as SyncStateRow;
  }

  function write_state(database: SqlDatabase, changes: Partial<Omit<SyncStateRow, "last_seq">>): void {
    for (const [column, value] of Object.entries(changes)) database.prepare(`UPDATE sync_state SET "${column}" = ?`).run(value as string | number);
  }

  function has_unpushed_changes(database: SqlDatabase): boolean {
    const { site, pushed_seq } = read_state(database);
    return database.prepare("SELECT 1 FROM sync_cells WHERE seq > ? AND site = ? LIMIT 1").get(pushed_seq, site) !== undefined;
  }

  function count_unpushed_rows(database: SqlDatabase): number {
    const { site, pushed_seq } = read_state(database);
    const row = database.prepare("SELECT count(DISTINCT table_name || char(0) || row_key) AS count FROM sync_cells WHERE seq > ? AND site = ?").get(pushed_seq, site);
    return (row as { count: number }).count;
  }

  // A restored backup is no longer the data others have seen, so it starts a new generation and follows no server.
  function forget_history(database: SqlDatabase): void {
    write_state(database, { generation: crypto.randomUUID(), server_generation: "" });
  }

  // ── Reading changes ──────────────────────────────────────────────────────

  function read_row(database: SqlDatabase, table: Table, row_key: string): Record<string, unknown> | undefined {
    return database.prepare(`SELECT * FROM "${table.name}" AS row WHERE ${key_sql(table, "row")} = ? AND ${filter_sql(table, "row")}`).get(row_key) as
      | Record<string, unknown>
      | undefined;
  }

  // Values are read as they are now; a row since removed sends only that it is gone.
  function cells_to_changes(database: SqlDatabase, cells: CellRow[]): SyncChange[] {
    const rows = new Map<string, Record<string, unknown> | undefined>();
    const changes: SyncChange[] = [];

    for (const cell of cells) {
      const table = tables_by_name.get(cell.table_name);
      if (!table) continue;
      const row_id = `${cell.table_name}\u0000${cell.row_key}`;
      if (!rows.has(row_id)) rows.set(row_id, read_row(database, table, cell.row_key));
      const row = rows.get(row_id);

      const base = { table: cell.table_name, key: cell.row_key, column: cell.column_name, ts: cell.ts, site: cell.site };
      const map_cell = split_map_cell(table, cell.column_name);
      if (cell.column_name === exists_column) changes.push({ ...base, value: row ? 1 : 0 });
      else if (map_cell) {
        if (row && map_cell.column in row) changes.push({ ...base, value: object_of(row[map_cell.column])[map_cell.key] ?? null });
      }
      else if (row && cell.column_name in row) changes.push({ ...base, value: row[cell.column_name] });
    }
    return changes;
  }

  // This device's own changes the server has not had yet, and the counter they were read at.
  function collect_unpushed_changes(database: SqlDatabase): CollectedChanges {
    const { site, pushed_seq, last_seq } = read_state(database);
    const cells = database
      .prepare("SELECT table_name, row_key, column_name, ts, site FROM sync_cells WHERE seq > ? AND seq <= ? AND site = ? ORDER BY seq")
      .all(pushed_seq, last_seq, site) as CellRow[];
    return { changes: cells_to_changes(database, cells), up_to_seq: last_seq };
  }

  // Every change after the cursor that another device should hear about, leaving out the ones it made itself.
  function collect_changes_since(database: SqlDatabase, cursor: number, except_site: string): CollectedChanges {
    const { last_seq } = read_state(database);
    const cells = database
      .prepare("SELECT table_name, row_key, column_name, ts, site FROM sync_cells WHERE seq > ? AND seq <= ? AND site != ? ORDER BY seq")
      .all(cursor, last_seq, except_site) as CellRow[];
    return { changes: cells_to_changes(database, cells), up_to_seq: last_seq };
  }

  // Every row there is now, with its versions, enough to rebuild the data elsewhere.
  function collect_snapshot(database: SqlDatabase): CollectedChanges {
    const { last_seq } = read_state(database);
    const changes: SyncChange[] = [];

    for (const table of tables) {
      const cells = database
        .prepare(
          `SELECT table_name, row_key, column_name, ts, site FROM sync_cells
           WHERE table_name = ? AND row_key IN (SELECT ${key_sql(table, "row")} FROM "${table.name}" AS row WHERE ${filter_sql(table, "row")})`,
        )
        .all(table.name) as CellRow[];
      changes.push(...cells_to_changes(database, cells));
    }
    return { changes, up_to_seq: last_seq };
  }

  // ── Applying changes ─────────────────────────────────────────────────────

  function is_newer(change: { ts: number; site: string }, current: { ts: number; site: string } | undefined): boolean {
    return !current || change.ts > current.ts || (change.ts === current.ts && change.site > current.site);
  }

  function record_cell(database: SqlDatabase, change: SyncChange): void {
    database.exec("UPDATE sync_state SET last_seq = last_seq + 1");
    database
      .prepare(
        `INSERT INTO sync_cells (table_name, row_key, column_name, ts, site, seq) VALUES (?, ?, ?, ?, ?, (SELECT last_seq FROM sync_state))
         ON CONFLICT (table_name, row_key, column_name) DO UPDATE SET ts = excluded.ts, site = excluded.site, seq = excluded.seq`,
      )
      .run(change.table, change.key, change.column, change.ts, change.site);
  }

  // Changes from another device for one row: whether it should exist, then each value newer than this device's.
  function apply_row_changes(database: SqlDatabase, table: Table, known: KnownColumns, row_key: string, changes: SyncChange[]): number {
    const { columns: known_columns, map_columns: known_map_columns } = known;
    const current_cells = new Map(
      (database.prepare("SELECT column_name, ts, site FROM sync_cells WHERE table_name = ? AND row_key = ?").all(table.name, row_key) as CellRow[]).map(
        (cell) => [cell.column_name, cell],
      ),
    );
    const where_row = `${key_sql(table, "row")} = ? AND ${filter_sql(table, "row")}`;
    let exists = database.prepare(`SELECT 1 FROM "${table.name}" AS row WHERE ${where_row}`).get(row_key) !== undefined;
    let applied = 0;

    const exists_change = changes.find((change) => change.column === exists_column);
    if (exists_change && is_newer(exists_change, current_cells.get(exists_column))) {
      record_cell(database, exists_change);
      applied += 1;
      if (exists_change.value === 1 && !exists) {
        const values: [string, SqlValue][] = [
          ...changes.filter((change) => change.column !== exists_column && known_columns.includes(change.column)).map((change) => [change.column, change.value as SqlValue] as [string, SqlValue]),
          ...known_map_columns.map((column) => [column, "{}"] as [string, SqlValue]),
        ];
        database
          .prepare(`INSERT INTO "${table.name}" (${values.map(([column]) => `"${column}"`).join(", ")}) VALUES (${values.map(() => "?").join(", ")})`)
          .run(...values.map(([, value]) => value));
        exists = true;
      }
      if (exists_change.value === 0 && exists) {
        database.prepare(`DELETE FROM "${table.name}" WHERE rowid IN (SELECT rowid FROM "${table.name}" AS row WHERE ${where_row})`).run(row_key);
        exists = false;
      }
    }

    for (const change of changes) {
      const map_cell = split_map_cell(table, change.column);
      const is_known = map_cell ? known_map_columns.includes(map_cell.column) : known_columns.includes(change.column);
      if (change.column === exists_column || !is_known || !is_newer(change, current_cells.get(change.column))) continue;
      record_cell(database, change);
      applied += 1;
      if (exists && map_cell) {
        const select = `SELECT "${map_cell.column}" AS value FROM "${table.name}" AS row WHERE ${where_row}`;
        const object = object_of((database.prepare(select).get(row_key) as { value: unknown }).value);
        if (change.value === null || change.value === undefined) delete object[map_cell.key];
        else object[map_cell.key] = change.value;
        database
          .prepare(`UPDATE "${table.name}" SET "${map_cell.column}" = ? WHERE rowid IN (SELECT rowid FROM "${table.name}" AS row WHERE ${where_row})`)
          .run(JSON.stringify(object), row_key);
      } else if (exists) {
        database
          .prepare(`UPDATE "${table.name}" SET "${change.column}" = ? WHERE rowid IN (SELECT rowid FROM "${table.name}" AS row WHERE ${where_row})`)
          .run(change.value as SqlValue, row_key);
      }
    }
    return applied;
  }

  // Rows left pointing at something another device removed go too; every device removes the same ones.
  function remove_orphans(database: SqlDatabase): void {
    for (;;) {
      const orphans = database.prepare("PRAGMA foreign_key_check").all() as { table: string; rowid: number }[];
      if (orphans.length === 0) return;
      for (const orphan of orphans) database.prepare(`DELETE FROM "${orphan.table}" WHERE rowid = ?`).run(orphan.rowid);
    }
  }

  function in_sync_transaction<Result>(database: SqlDatabase, work: () => Result): Result {
    database.exec("BEGIN");
    try {
      database.exec("UPDATE sync_state SET is_applying = 1");
      database.exec("PRAGMA defer_foreign_keys = ON");
      const result = work();
      remove_orphans(database);
      options.after_apply?.(database);
      database.exec("UPDATE sync_state SET is_applying = 0");
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function apply_each_row(database: SqlDatabase, changes: SyncChange[]): number {
    const rows = new Map<string, { table: Table; key: string; changes: SyncChange[] }>();
    for (const change of changes) {
      const table = tables_by_name.get(change.table);
      if (!table || table.local_keys.includes(change.key)) continue;
      const row_id = `${change.table}\u0000${change.key}`;
      const row = rows.get(row_id) ?? { table, key: change.key, changes: [] };
      row.changes.push(change);
      rows.set(row_id, row);
    }

    const ordered_rows = [...rows.values()].sort((first, second) => tables.indexOf(first.table) - tables.indexOf(second.table));
    const known_columns = new Map(tables.map((table): [Table, KnownColumns] => [table, { columns: synced_columns(database, table), map_columns: synced_map_columns(database, table) }]));
    let applied = 0;
    for (const row of ordered_rows) applied += apply_row_changes(database, row.table, known_columns.get(row.table)!, row.key, row.changes);
    return applied;
  }

  // Applies changes from another device as one transaction, and returns how many were newer than what this device had.
  function apply_changes(database: SqlDatabase, changes: SyncChange[]): number {
    return in_sync_transaction(database, () => apply_each_row(database, changes));
  }

  // Swaps every synced row for another copy's data in one transaction; rows kept to this device stay.
  function replace_with_snapshot(database: SqlDatabase, changes: SyncChange[]): void {
    in_sync_transaction(database, () => {
      for (const table of [...tables].reverse()) {
        database.exec(`DELETE FROM "${table.name}" WHERE rowid IN (SELECT rowid FROM "${table.name}" AS row WHERE ${filter_sql(table, "row")})`);
      }
      database.exec("DELETE FROM sync_cells");
      apply_each_row(database, changes);
    });
  }

  return {
    install,
    drop_triggers,
    stamp_existing_rows,
    read_state,
    write_state,
    has_unpushed_changes,
    count_unpushed_rows,
    forget_history,
    collect_unpushed_changes,
    collect_changes_since,
    collect_snapshot,
    apply_changes,
    replace_with_snapshot,
  };
}
