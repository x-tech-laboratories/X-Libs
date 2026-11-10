import { describe, expect, test, vi } from "vitest";

import { backup_naming } from "../src/backups.ts";
import { from_base64, phone_backups, to_base64, type BackupFolderPlugin, type PhoneDatabase } from "../src/phone_backups.ts";
import type { SqlDatabase } from "../src/sql.ts";

const naming = backup_naming("budget", ".db");

// The Android folder as a map of names to base64, with a folder picked or not.
function fake_folder(picked = true) {
  const files = new Map<string, string>();
  let name = picked ? "Backups" : "";
  const folder: BackupFolderPlugin = {
    get_folder: async () => ({ name }),
    choose_folder: async () => ((name = "Documents"), { name }),
    list: async () => ({ files: [...files].map(([file, data]) => ({ name: file, size_bytes: from_base64(data).byteLength })) }),
    write: async ({ name: file, data }) => void files.set(file, data),
    read: async ({ name: file }) => ({ data: files.get(file)! }),
    remove: async ({ name: file }) => void files.delete(file),
  };
  return { folder, files };
}

function fake_database(bytes: number[]) {
  let current: Uint8Array = Uint8Array.from(bytes);
  const database: PhoneDatabase = {
    connection: {} as SqlDatabase,
    export_bytes: () => current,
    replace_with: (next) => void (current = next),
    save_now: vi.fn(async () => {}),
  };
  return { database, current: () => [...current] };
}

describe("phone backups", () => {
  test("carries bytes across as base64 and back, beyond one chunk", () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, index) => index % 256);
    expect(from_base64(to_base64(bytes))).toEqual(bytes);
  });

  test("writes backups to the picked folder and lists them newest first", async () => {
    const { folder } = fake_folder();
    const kept = phone_backups({ naming, database: fake_database([1, 2, 3]).database, folder });

    const backup = await kept.create();
    expect(backup).toMatchObject({ is_automatic: false, size_bytes: 3 });
    expect((await kept.list()).map((each) => each.name)).toEqual([backup.name]);
    expect(await kept.folder_name()).toBe("Backups");
  });

  test("restores a backup after backing up the current data, then saves", async () => {
    const { folder, files } = fake_folder();
    const { database, current } = fake_database([1]);
    const after_restore = vi.fn();
    const kept = phone_backups({ naming, database, folder, after_restore });
    files.set("budget-2026-06-10T09-30-00Z.db", to_base64(Uint8Array.from([9, 9])));

    await kept.restore("budget-2026-06-10T09-30-00Z.db");
    expect(current()).toEqual([9, 9]);
    expect(after_restore).toHaveBeenCalledWith(database.connection);
    expect(database.save_now).toHaveBeenCalled();
    expect(files.size).toBe(2);
    await expect(kept.restore("../budget.db")).rejects.toThrow("not a backup name");
  });

  test("waits quietly for a folder before taking daily backups", async () => {
    const { folder, files } = fake_folder(false);
    const kept = phone_backups({ naming, database: fake_database([1]).database, folder });

    await kept.keep_automatic(14);
    expect(files.size).toBe(0);
    expect(await kept.list()).toEqual([]);

    expect(await kept.choose_folder()).toBe("Documents");
    await kept.keep_automatic(14);
    expect([...files.keys()].every((name) => name.endsWith("-auto.db"))).toBe(true);
    expect(files.size).toBe(1);
  });
});
