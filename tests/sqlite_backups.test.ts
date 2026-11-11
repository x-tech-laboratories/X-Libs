import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";

import { backup_naming, backups, keep_backing_up, type BackupStore } from "../src/backups.ts";
import { sqlite_backups, staged_restore_path, take_staged_restore } from "../src/server/sqlite_backups.ts";

afterEach(() => vi.useRealTimers());

const naming = backup_naming("tasks", ".db");

test("daily backups are taken at once and on each check while the schedule asks for them", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T09:00:00Z") });
  const names: string[] = [];
  const store: BackupStore = { list: () => names.map((name) => ({ name, size_bytes: 1 })), take: (name) => (names.push(name), 1), remove: () => {} };
  let automatic = false;

  const running = keep_backing_up(backups(naming, store), () => ({ automatic, to_keep: 3 }), { check_every_ms: 1000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(names).toEqual([]);
  automatic = true;
  await running.check();
  expect(names).toEqual(["tasks-2026-11-10T09-00-00Z-auto.db"]);
  vi.setSystemTime(new Date("2026-11-11T09:00:00Z"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(names).toHaveLength(2);
  running.stop();
});

test("a failed automatic backup is reported and never thrown", async () => {
  const on_error = vi.fn();
  const store: BackupStore = { list: () => [], take: () => { throw new Error("disk full"); }, remove: () => {} };

  const running = keep_backing_up(backups(naming, store), () => ({ automatic: true, to_keep: 3 }), { on_error });
  await running.check();
  running.stop();

  expect(on_error).toHaveBeenCalledWith(new Error("disk full"));
});

test("restoring puts the backup's data back, after backing up what was there, and runs the after-restore step", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T09:00:00Z"), toFake: ["Date"] });
  const folder = mkdtempSync(join(tmpdir(), "sqlite-backups-"));
  const path = join(folder, "tasks.db");
  let database = new DatabaseSync(path);
  database.exec("CREATE TABLE tasks (title TEXT); INSERT INTO tasks VALUES ('before')");
  const after_restore = vi.fn();
  const kept = sqlite_backups({
    folder: () => join(folder, "backups"), naming, database: () => database, database_path: () => path,
    close: () => database.close(), open: () => void (database = new DatabaseSync(path)), after_restore,
  });

  const first = await kept.create();
  database.exec("UPDATE tasks SET title = 'after'");
  vi.setSystemTime(new Date("2026-11-10T10:00:00Z"));
  await kept.restore(first.name);

  expect(database.prepare("SELECT title FROM tasks").get()).toEqual({ title: "before" });
  expect((await kept.list()).map((backup) => backup.taken_at)).toEqual(["2026-11-10T10:00:00Z", "2026-11-10T09:00:00Z"]);
  expect(after_restore).toHaveBeenCalledWith(database);
  database.close();
});

test("restoring within the same second as the backup it restores still backs up what was there", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T09:00:00Z"), toFake: ["Date"] });
  const folder = mkdtempSync(join(tmpdir(), "sqlite-backups-"));
  const path = join(folder, "tasks.db");
  let database = new DatabaseSync(path);
  database.exec("CREATE TABLE tasks (title TEXT); INSERT INTO tasks VALUES ('before')");
  const kept = sqlite_backups({
    folder: () => join(folder, "backups"), naming, database: () => database, database_path: () => path,
    close: () => database.close(), open: () => void (database = new DatabaseSync(path)),
  });

  const first = await kept.create();
  database.exec("UPDATE tasks SET title = 'after'");
  await kept.restore(first.name);

  expect(database.prepare("SELECT title FROM tasks").get()).toEqual({ title: "before" });
  const [replaced] = await kept.list();
  expect(replaced.name).toBe("tasks-2026-11-10T09-00-00Z-2.db");
  const copy = new DatabaseSync(join(folder, "backups", replaced.name));
  expect(copy.prepare("SELECT title FROM tasks").get()).toEqual({ title: "after" });
  copy.close();
  database.close();
});

test("a server stages the restore and takes it in on its next start, before opening the database", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T09:00:00Z"), toFake: ["Date"] });
  const folder = mkdtempSync(join(tmpdir(), "sqlite-backups-"));
  const path = join(folder, "state.db");
  let database = new DatabaseSync(path);
  database.exec("CREATE TABLE accounts (name TEXT); INSERT INTO accounts VALUES ('before')");
  const after_staging = vi.fn();
  const kept = sqlite_backups({ folder: () => join(folder, "backups"), naming, database: () => database, database_path: () => path, after_staging });

  const first = await kept.create();
  database.exec("UPDATE accounts SET name = 'after'");
  vi.setSystemTime(new Date("2026-11-10T10:00:00Z"));
  await kept.restore(first.name);

  expect(database.prepare("SELECT name FROM accounts").get()).toEqual({ name: "after" });
  expect(after_staging).toHaveBeenCalled();
  database.close();
  expect(take_staged_restore(path)).toBe(true);
  expect(existsSync(staged_restore_path(path))).toBe(false);
  database = new DatabaseSync(path);
  expect(database.prepare("SELECT name FROM accounts").get()).toEqual({ name: "before" });
  expect(take_staged_restore(path)).toBe(false);
  database.close();
});
