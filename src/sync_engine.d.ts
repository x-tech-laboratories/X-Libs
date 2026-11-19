import type { SqlDatabase } from "./sql.ts";
import type { SyncChange } from "./sync_protocol.ts";
export interface SyncedTable {
    name: string;
    key_columns: string[];
    local_columns?: string[];
    local_keys?: readonly string[];
}
export interface SyncEngineOptions {
    tables: SyncedTable[];
    after_apply?: (database: SqlDatabase) => void;
}
export interface SyncStateRow {
    site: string;
    generation: string;
    server_generation: string;
    last_seq: number;
    pushed_seq: number;
    pulled_seq: number;
}
export interface CollectedChanges {
    changes: SyncChange[];
    up_to_seq: number;
}
export type SyncEngine = ReturnType<typeof create_sync_engine>;
export declare const sync_schema_sql = "\n  CREATE TABLE IF NOT EXISTS sync_state (\n    id INTEGER PRIMARY KEY CHECK (id = 1),\n    site TEXT NOT NULL,\n    generation TEXT NOT NULL,\n    server_generation TEXT NOT NULL DEFAULT '',\n    last_seq INTEGER NOT NULL DEFAULT 0,\n    pushed_seq INTEGER NOT NULL DEFAULT 0,\n    pulled_seq INTEGER NOT NULL DEFAULT 0,\n    is_applying INTEGER NOT NULL DEFAULT 0\n  );\n  INSERT OR IGNORE INTO sync_state (id, site, generation) VALUES (1, lower(hex(randomblob(16))), lower(hex(randomblob(16))));\n  CREATE TABLE IF NOT EXISTS sync_cells (\n    table_name TEXT NOT NULL,\n    row_key TEXT NOT NULL,\n    column_name TEXT NOT NULL,\n    ts INTEGER NOT NULL,\n    site TEXT NOT NULL,\n    seq INTEGER NOT NULL,\n    PRIMARY KEY (table_name, row_key, column_name)\n  ) WITHOUT ROWID;\n  CREATE INDEX IF NOT EXISTS sync_cells_by_seq ON sync_cells (seq);";
export declare function create_sync_engine(options: SyncEngineOptions): {
    install: (database: SqlDatabase) => void;
    drop_triggers: (database: SqlDatabase) => void;
    stamp_existing_rows: (database: SqlDatabase, table_name: string) => void;
    read_state: (database: SqlDatabase) => SyncStateRow;
    write_state: (database: SqlDatabase, changes: Partial<Omit<SyncStateRow, "last_seq">>) => void;
    has_unpushed_changes: (database: SqlDatabase) => boolean;
    count_unpushed_rows: (database: SqlDatabase) => number;
    forget_history: (database: SqlDatabase) => void;
    collect_unpushed_changes: (database: SqlDatabase) => CollectedChanges;
    collect_changes_since: (database: SqlDatabase, cursor: number, except_site: string) => CollectedChanges;
    collect_snapshot: (database: SqlDatabase) => CollectedChanges;
    apply_changes: (database: SqlDatabase, changes: SyncChange[]) => number;
    replace_with_snapshot: (database: SqlDatabase, changes: SyncChange[]) => void;
};
