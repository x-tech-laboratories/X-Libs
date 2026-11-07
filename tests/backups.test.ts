import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { backup_naming, backups, type BackupStore } from "../src/backups.ts";
import { file_backup_store } from "../src/server/backup_files.ts";

// ============================================================================
// Setup
// ============================================================================

const naming = backup_naming("tasks", ".db");

// A store kept in memory, each backup a fixed size.
function memory_store(names: string[] = []): BackupStore & { names: string[] } {
  const store = {
    names,
    list: () => store.names.map((name) => ({ name, size_bytes: 10 })),
    take: (name: string) => {
      store.names.push(name);
      return 10;
    },
    remove: (name: string) => void (store.names = store.names.filter((each) => each !== name)),
  };
  return store;
}

// ============================================================================
// Names
// ============================================================================

describe("backup_naming", () => {
  test("names a backup by when it was taken and reads that back", () => {
    const name = naming.name_for(new Date("2026-06-10T09:30:05Z"), true);

    expect(name).toBe("tasks-2026-06-10T09-30-05Z-auto.db");
    expect(naming.describe(name, 42)).toEqual({ name, taken_at: "2026-06-10T09:30:05Z", is_automatic: true, size_bytes: 42 });
  });

  test("refuses names it did not write, such as one reaching outside the folder", () => {
    expect(naming.pattern.test("../tasks-2026-06-10T09-30-05Z.db")).toBe(false);
    expect(() => naming.describe("notes.txt", 1)).toThrow("not a backup name");
  });
});

// ============================================================================
// Keeping
// ============================================================================

describe("backups", () => {
  test("lists newest first and leaves out other files", async () => {
    const store = memory_store(["tasks-2026-06-01T00-00-00Z.db", "notes.txt", "tasks-2026-06-03T00-00-00Z-auto.db"]);

    expect((await backups(naming, store).list()).map((backup) => backup.name)).toEqual(["tasks-2026-06-03T00-00-00Z-auto.db", "tasks-2026-06-01T00-00-00Z.db"]);
  });

  test("takes an automatic backup once a day has passed and keeps only the newest automatic ones", async () => {
    const store = memory_store(["tasks-2026-06-01T00-00-00Z-auto.db", "tasks-2026-06-02T00-00-00Z-auto.db", "tasks-2026-05-01T00-00-00Z.db"]);
    const set = backups(naming, store);

    await set.keep_automatic(2, undefined, new Date("2026-06-02T12:00:00Z"));
    expect(store.names).toHaveLength(3);

    await set.keep_automatic(2, undefined, new Date("2026-06-03T00:00:00Z"));
    expect(store.names.sort()).toEqual(["tasks-2026-05-01T00-00-00Z.db", "tasks-2026-06-02T00-00-00Z-auto.db", "tasks-2026-06-03T00-00-00Z-auto.db"]);
  });

  test("refuses to remove a name it did not write", async () => {
    await expect(backups(naming, memory_store()).remove("../outside.db")).rejects.toThrow("not a backup name");
  });
});

describe("file_backup_store", () => {
  test("writes, lists and removes backup files in its folder", async () => {
    const folder = join(mkdtempSync(join(tmpdir(), "x-libs-backups-")), "backups");
    const set = backups(naming, file_backup_store(() => folder, naming, (path) => writeFileSync(path, "data")));

    const backup = await set.create();
    expect(backup.size_bytes).toBe(4);
    expect((await set.list()).map((each) => each.name)).toEqual([backup.name]);

    await set.remove(backup.name);
    expect(readdirSync(folder)).toEqual([]);
  });
});
