import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { file_sync_storage } from "../src/sync_file_storage.ts";

const config = { server_url: "https://sync.example", token: "not-a-real-token" };

function folder(): string {
  return mkdtempSync(join(tmpdir(), "x-libs-sync-storage-"));
}

describe("file_sync_storage", () => {
  it("reads null while there is no file, then what was written, in a file only its owner can read", () => {
    const file = join(folder(), "profile", "sync.json");
    const storage = file_sync_storage({ file, back_up_before_download: () => {} });
    expect(storage.read_config()).toBeNull();

    storage.write_config(config);

    expect(storage.read_config()).toEqual(config);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(config);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("tightens a file left readable by others", () => {
    const file = join(folder(), "sync.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o644);

    file_sync_storage({ file, back_up_before_download: () => {} }).write_config(config);

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("removes the file, and removing it again does nothing", () => {
    const file = join(folder(), "sync.json");
    const storage = file_sync_storage({ file, back_up_before_download: () => {} });
    storage.write_config(config);

    storage.remove_config();
    expect(storage.read_config()).toBeNull();
    expect(() => storage.remove_config()).not.toThrow();
  });

  it("hands on the backup it was given", async () => {
    const back_up = vi.fn(async () => {});
    await file_sync_storage({ file: join(folder(), "sync.json"), back_up_before_download: back_up }).back_up_before_download();
    expect(back_up).toHaveBeenCalledTimes(1);
  });
});
