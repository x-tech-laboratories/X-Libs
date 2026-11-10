// SQLite compiled to WebAssembly for a page that keeps its own database, such as a phone app on Capacitor: the database
// lives in memory and is saved whole to the page's IndexedDB shortly after each change, which a phone keeps until the
// app's data is cleared. It meets the same SqlDatabase as node:sqlite, so store code and sync run on it unchanged.

// ── Imports ──────────────────────────────────────────────────────────────────

import sqlite3_init, { type Database, type SqlValue as WasmSqlValue } from "@sqlite.org/sqlite-wasm";

import type { SqlDatabase, SqlStatement, SqlValue } from "../sql.ts";

// ── Saved files ──────────────────────────────────────────────────────────────

export interface FileStore {
  read: (name: string) => Promise<Uint8Array | undefined>;
  write: (name: string, bytes: Uint8Array) => Promise<void>;
}

// One object store of files in the named IndexedDB database.
export function indexed_db_files(database_name: string): FileStore {
  const store_name = "files";
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(database_name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(store_name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  return {
    read: async (name) => {
      const store = await open();
      return new Promise((resolve, reject) => {
        const request = store.transaction(store_name).objectStore(store_name).get(name);
        request.onsuccess = () => resolve(request.result as Uint8Array | undefined);
        request.onerror = () => reject(request.error);
      });
    },
    write: async (name, bytes) => {
      const store = await open();
      return new Promise((resolve, reject) => {
        const transaction = store.transaction(store_name, "readwrite");
        transaction.objectStore(store_name).put(bytes, name);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
  };
}

// ── Connection ───────────────────────────────────────────────────────────────

export interface WasmDatabaseOptions {
  files: FileStore;
  file_name: string;
  // How long after a change the database is saved; 300 ms unless set.
  save_delay_ms?: number;
}

export interface WasmDatabase {
  connection: SqlDatabase;
  // Saves the database now, as when the app goes to the background.
  save_now: () => Promise<void>;
  // The whole database as a file, for keeping a copy.
  export_bytes: () => Uint8Array;
  // Swaps the open database's contents for a saved copy; the caller saves it once it is ready.
  replace_with: (bytes: Uint8Array) => void;
}

function to_wasm_value(value: SqlValue): WasmSqlValue {
  return typeof value === "bigint" ? Number(value) : value;
}

function run_statement(database: Database, sql: string, params: SqlValue[]): Record<string, WasmSqlValue>[] {
  const statement = database.prepare(sql);
  try {
    if (params.length > 0) statement.bind(params.map(to_wasm_value));
    const rows: Record<string, WasmSqlValue>[] = [];
    while (statement.step()) rows.push(statement.get({}));
    return rows;
  } finally {
    statement.finalize();
  }
}

// Opens the saved database, or a new one, and saves it shortly after every change.
export async function open_wasm_database(options: WasmDatabaseOptions): Promise<WasmDatabase> {
  const sqlite3 = await sqlite3_init();
  const database = new sqlite3.oo1.DB(":memory:");

  const load_bytes = (bytes: Uint8Array): void => {
    const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
    const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    database.checkRc(sqlite3.capi.sqlite3_deserialize(database.pointer!, "main", pointer, bytes.byteLength, bytes.byteLength, flags));
  };

  const saved = await options.files.read(options.file_name);
  if (saved) load_bytes(saved);

  const export_bytes = (): Uint8Array => sqlite3.capi.sqlite3_js_db_export(database.pointer!);
  let save_timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> = Promise.resolve();

  const save_now = (): Promise<void> => {
    clearTimeout(save_timer);
    save_timer = undefined;
    saving = saving.then(() => options.files.write(options.file_name, export_bytes()));
    return saving;
  };
  const save_soon = (): void => {
    save_timer ??= setTimeout(() => void save_now(), options.save_delay_ms ?? 300);
  };

  const prepare = (sql: string): SqlStatement => {
    let returns_arrays = false;
    // A statement that returns rows can still write, such as INSERT ... RETURNING, so the change count decides the save.
    const rows = (params: SqlValue[]): unknown[] => {
      const changes_before = sqlite3.capi.sqlite3_total_changes(database.pointer!);
      const found = run_statement(database, sql, params);
      if (sqlite3.capi.sqlite3_total_changes(database.pointer!) !== changes_before) save_soon();
      return returns_arrays ? found.map((row) => Object.values(row)) : found;
    };
    return {
      run: (...params) => {
        run_statement(database, sql, params);
        save_soon();
        return { changes: database.changes(), lastInsertRowid: sqlite3.capi.sqlite3_last_insert_rowid(database.pointer!) };
      },
      get: (...params) => rows(params)[0],
      all: (...params) => rows(params),
      setReturnArrays: (on) => {
        returns_arrays = on;
      },
    };
  };

  const connection: SqlDatabase = {
    exec: (sql) => {
      database.exec(sql);
      save_soon();
    },
    prepare,
    close: () => database.close(),
  };

  return { connection, save_now, export_bytes, replace_with: load_bytes };
}
