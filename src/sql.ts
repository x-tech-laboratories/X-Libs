// The part of a synchronous SQLite connection the X-apps use, met by Node's node:sqlite and by SQLite compiled to
// WebAssembly, so the same store code and sync run on a server, a desktop app and a phone.

// ── Connection ───────────────────────────────────────────────────────────────

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  run: (...params: SqlValue[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: SqlValue[]) => unknown;
  all: (...params: SqlValue[]) => unknown[];
}

export interface SqlDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqlStatement;
  close: () => void;
}

// ── Transactions ─────────────────────────────────────────────────────────────

// Runs the work as one transaction, rolled back if it throws so the connection is never left mid-transaction.
export function in_transaction<Result>(database: SqlDatabase, work: () => Result): Result {
  database.exec("BEGIN");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

// ── Migrations ───────────────────────────────────────────────────────────────

// Brings the database up to the last step through SQLite's user_version, each step once and in its own transaction.
export function migrate(database: SqlDatabase, steps: readonly string[]): void {
  const { user_version } = database.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = user_version; version < steps.length; version++) {
    in_transaction(database, () => {
      database.exec(steps[version]!);
      database.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}
