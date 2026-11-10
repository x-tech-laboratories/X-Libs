// The part of a synchronous SQLite connection the X-apps use, met by Node's node:sqlite and by SQLite compiled to
// WebAssembly, so the same store code and sync run on a server, a desktop app and a phone.

// ── Connection ───────────────────────────────────────────────────────────────

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  run: (...params: SqlValue[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: SqlValue[]) => unknown;
  all: (...params: SqlValue[]) => unknown[];
  // Rows as lists of values instead of objects, as node:sqlite does; Drizzle asks for it.
  setReturnArrays?: (on: boolean) => void;
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

// One step is a script, or its statements one by one, such as a migration drizzle-kit wrote.
export type MigrationStep = string | readonly string[];

export interface MigrateOptions {
  // Keeps this list's version apart from others in the same database, such as one per feature or plugin.
  owner?: string;
}

function run_step(database: SqlDatabase, step: MigrationStep): void {
  for (const statement of typeof step === "string" ? [step] : step) database.exec(statement);
}

// Brings the database up to the last step, each step once and in its own transaction; without an owner the version is SQLite's user_version.
export function migrate(database: SqlDatabase, steps: readonly MigrationStep[], options: MigrateOptions = {}): void {
  const { owner } = options;
  if (owner !== undefined) database.exec("CREATE TABLE IF NOT EXISTS schema_versions (owner TEXT PRIMARY KEY, version INTEGER NOT NULL)");
  const read_version = (): number =>
    owner === undefined
      ? (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
      : ((database.prepare("SELECT version FROM schema_versions WHERE owner = ?").get(owner) as { version: number } | undefined)?.version ?? 0);

  for (let version = read_version(); version < steps.length; version++) {
    in_transaction(database, () => {
      run_step(database, steps[version]!);
      if (owner === undefined) database.exec(`PRAGMA user_version = ${version + 1}`);
      else database.prepare("INSERT INTO schema_versions (owner, version) VALUES (?, ?) ON CONFLICT (owner) DO UPDATE SET version = excluded.version").run(owner, version + 1);
    });
  }
}
