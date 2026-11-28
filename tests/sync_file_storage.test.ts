import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { file_sync_storage } from "../src/sync_file_storage.ts";
import type { PeerRecord } from "../src/sync_protocol.ts";
import { create_identity } from "../src/sync_seal.ts";

const identity = create_identity();
const other = create_identity();
const peer: PeerRecord = { device: other.device, public_key: other.public_key, name: "Laptop", addresses: ["http://192.168.1.5:3920/"], updated_at: 1, removed: false };

function folder(): string {
  return mkdtempSync(join(tmpdir(), "x-libs-sync-storage-"));
}

describe("file_sync_storage", () => {
  it("reads nothing while there is no file, then the keys and devices written, in a file only its owner can read", () => {
    const file = join(folder(), "profile", "sync-peers.json");
    const storage = file_sync_storage({ file, back_up_before_replace: () => {} });
    expect(storage.read_identity()).toBeNull();
    expect(storage.read_peers()).toEqual([]);

    storage.write_identity(identity);
    storage.write_peers([peer]);

    expect(storage.read_identity()).toEqual(identity);
    expect(storage.read_peers()).toEqual([peer]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("tightens a file left readable by others, and reads a file of another shape as empty", () => {
    const file = join(folder(), "sync-peers.json");
    writeFileSync(file, JSON.stringify({ server_url: "https://old.example" }));
    chmodSync(file, 0o644);
    const storage = file_sync_storage({ file, back_up_before_replace: () => {} });
    expect(storage.read_identity()).toBeNull();

    storage.write_peers([peer]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    writeFileSync(file, "not json");
    expect(storage.read_peers()).toEqual([]);
  });

  it("hands on the backup it was given", async () => {
    const back_up = vi.fn(async () => {});
    await file_sync_storage({ file: join(folder(), "sync-peers.json"), back_up_before_replace: back_up }).back_up_before_replace();
    expect(back_up).toHaveBeenCalledTimes(1);
  });
});
