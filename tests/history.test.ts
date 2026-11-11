import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";

import { create_history, type HistoryOptions } from "../src/history.ts";
import type { SqlDatabase } from "../src/sql.ts";

afterEach(() => vi.useRealTimers());

interface TaskSnapshot {
  title: string;
  parent_id: string | null;
  tag_ids: string[];
}

function open(): SqlDatabase {
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  database.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT REFERENCES tasks (id) ON DELETE CASCADE);
                 CREATE TABLE task_tags (task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE, tag_id TEXT NOT NULL, PRIMARY KEY (task_id, tag_id));
                 PRAGMA foreign_keys = ON;`);
  return database;
}

const history_options = {
  name: "task",
  item_table: "tasks",
  watches: [{ table: "tasks", item_columns: ["id"] }, { table: "task_tags", item_columns: ["task_id"] }],
  read: (database, id) => {
    const row = database.prepare("SELECT title, parent_id FROM tasks WHERE id = ?").get(id) as { title: string; parent_id: string | null } | undefined;
    if (!row) return null;
    const tags = database.prepare("SELECT tag_id FROM task_tags WHERE task_id = ? ORDER BY tag_id").all(id) as { tag_id: string }[];
    return { ...row, tag_ids: tags.map((tag) => tag.tag_id) };
  },
  apply: (database, id, snapshot) => {
    database.prepare("INSERT INTO tasks (id, title, parent_id) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, parent_id = excluded.parent_id").run(id, snapshot.title, snapshot.parent_id);
    database.prepare("DELETE FROM task_tags WHERE task_id = ?").run(id);
    for (const tag_id of snapshot.tag_ids) database.prepare("INSERT INTO task_tags VALUES (?, ?)").run(id, tag_id);
  },
  parent_of: (snapshot) => snapshot.parent_id,
  site: () => "this-device",
} satisfies HistoryOptions<TaskSnapshot>;

const history = create_history<TaskSnapshot>(history_options);

test("items already there get a first version, and each write after records one version of what it touched", () => {
  const database = open();
  database.exec("INSERT INTO tasks VALUES ('a', 'Old', NULL)");
  history.install(database);

  database.exec("UPDATE tasks SET title = 'New' WHERE id = 'a'; INSERT INTO task_tags VALUES ('a', 'home')");
  history.record(database);
  database.exec("UPDATE tasks SET title = 'New' WHERE id = 'a'");
  history.record(database);

  const versions = history.read_versions(database, "a");
  expect(versions.map((version) => version.kind)).toEqual(["edited", "first_seen"]);
  expect(versions[0]!.snapshot).toEqual({ title: "New", parent_id: null, tag_ids: ["home"] });
  expect(versions[0]!.previous).toEqual({ title: "Old", parent_id: null, tag_ids: [] });
  expect(versions[0]!.origin).toBe("here");
  expect(versions[1]!.id).toBe("first_seen:a");
});

test("restoring a deleted item brings back what was deleted with it beneath it, each naming its version", () => {
  const database = open();
  history.install(database);
  database.exec("INSERT INTO tasks VALUES ('parent', 'Trip', NULL); INSERT INTO tasks VALUES ('child', 'Pack', 'parent')");
  history.record(database);
  database.exec("DELETE FROM tasks WHERE id = 'parent'");
  history.record(database);

  const deleted = history.read_versions(database, "parent")[0]!;
  expect(deleted.kind).toBe("deleted");
  history.restore(database, deleted.id);

  expect(database.prepare("SELECT id FROM tasks ORDER BY id").all()).toEqual([{ id: "child" }, { id: "parent" }]);
  const child = history.read_versions(database, "child")[0]!;
  expect(child.kind).toBe("restored");
  expect(child.restored_from).toBe(history.read_versions(database, "child")[1]!.id);
});

test("changes from sync are forgotten, and pruning keeps each item's newest version", () => {
  vi.useFakeTimers({ now: new Date("2026-11-01T00:00:00Z"), toFake: ["Date"] });
  const database = open();
  history.install(database);
  database.exec("INSERT INTO tasks VALUES ('a', 'One', NULL)");
  history.record(database);
  vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
  database.exec("UPDATE tasks SET title = 'Two'");
  history.record(database);
  database.exec("UPDATE tasks SET title = 'From elsewhere'");
  history.forget_touched(database);
  history.record(database);

  history.prune(database, "2026-11-10T00:00:00Z");

  expect(history.read_recent(database, 10).map((version) => version.snapshot.title)).toEqual(["Two"]);
});

test("an app's own older versions table is taken over as it is, under its own item column", () => {
  const database = open();
  database.exec(`CREATE TABLE task_versions (id INTEGER PRIMARY KEY, uid TEXT, task_id TEXT NOT NULL, changed_at TEXT NOT NULL, kind TEXT NOT NULL,
                   site TEXT NOT NULL DEFAULT '', restored_from TEXT, snapshot TEXT NOT NULL);
                 CREATE UNIQUE INDEX task_versions_by_uid ON task_versions (uid);
                 CREATE TABLE task_versions_pending (task_id TEXT PRIMARY KEY) WITHOUT ROWID;
                 INSERT INTO tasks VALUES ('a', 'Old', NULL);
                 INSERT INTO task_versions (uid, task_id, changed_at, kind, snapshot)
                   VALUES ('first_seen:a', 'a', '2026-11-01T00:00:00Z', 'first_seen', '{"title":"Old","parent_id":null,"tag_ids":[]}');`);
  const adopted = create_history<TaskSnapshot>({ ...history_options, item_column: "task_id" });

  adopted.install(database);
  database.exec("UPDATE tasks SET title = 'New'");
  adopted.record(database);

  expect(adopted.read_versions(database, "a").map((version) => [version.kind, version.snapshot.title])).toEqual([["edited", "New"], ["first_seen", "Old"]]);
  expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'schema_versions'").get()).toEqual({ count: 0 });
});

test("a row that names its item only through another table records a version of that item", () => {
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  database.exec(`CREATE TABLE workouts (id TEXT PRIMARY KEY);
                 CREATE TABLE workout_exercises (id TEXT PRIMARY KEY, workout_id TEXT NOT NULL REFERENCES workouts (id) ON DELETE CASCADE);
                 CREATE TABLE workout_sets (id TEXT PRIMARY KEY, workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises (id) ON DELETE CASCADE, reps INTEGER NOT NULL);
                 PRAGMA foreign_keys = ON;`);
  const reps_of = (db: SqlDatabase, id: string) =>
    (db.prepare("SELECT reps FROM workout_sets JOIN workout_exercises ON workout_exercises.id = workout_exercise_id WHERE workout_id = ? ORDER BY workout_sets.id").all(id) as { reps: number }[]).map((set) => set.reps);
  const workouts = create_history<{ reps: number[] }>({
    name: "workout",
    item_table: "workouts",
    watches: [
      { table: "workouts", item_columns: ["id"] },
      { table: "workout_exercises", item_columns: ["workout_id"] },
      { table: "workout_sets", item_lookup: (row) => `SELECT workout_id FROM workout_exercises WHERE id = ${row}.workout_exercise_id` },
    ],
    read: (db, id) => (db.prepare("SELECT 1 FROM workouts WHERE id = ?").get(id) === undefined ? null : { reps: reps_of(db, id) }),
    apply: () => {},
    site: () => "this-device",
  });
  workouts.install(database);
  database.exec("INSERT INTO workouts VALUES ('w'); INSERT INTO workout_exercises VALUES ('e', 'w')");
  workouts.record(database);

  database.exec("INSERT INTO workout_sets VALUES ('s', 'e', 5)");
  workouts.record(database);
  database.exec("UPDATE workout_sets SET reps = 8 WHERE id = 's'");
  workouts.record(database);
  database.exec("DELETE FROM workouts WHERE id = 'w'");
  workouts.record(database);

  expect(workouts.read_versions(database, "w").map((version) => [version.kind, version.snapshot.reps])).toEqual([
    ["deleted", [8]],
    ["edited", [8]],
    ["edited", [5]],
    ["created", []],
  ]);
});
