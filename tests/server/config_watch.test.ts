import { mkdtempSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { config_fingerprint, file_digest, watch_config } from "../../src/server/config_watch.ts";

function setup(text: string) {
  const folder = mkdtempSync(join(tmpdir(), "config-watch-"));
  const path = join(folder, "config.yaml");
  writeFileSync(path, text);
  return { folder, path };
}

describe("watch_config", () => {
  it("reloads once the changed file has held still for one more check", async () => {
    const { path } = setup("a: 1\n");
    let loaded = await file_digest(path);
    const reloads: string[] = [];
    const watch = watch_config({ path, loaded_digest: () => loaded, reload: async () => { reloads.push("reload"); loaded = await file_digest(path); } }, false);

    // The first look only notes the file, and its content is what was loaded.
    expect(await watch.check()).toBe(false);
    expect(await watch.check()).toBe(false);

    writeFileSync(path, "a: 22\n");
    expect(await watch.check()).toBe(false);
    expect(await watch.check()).toBe(true);
    expect(reloads).toHaveLength(1);
    expect(await watch.check()).toBe(false);
  });

  it("skips a reload when the content is what was loaded, as after a touch", async () => {
    const { path } = setup("a: 1\n");
    const loaded = await file_digest(path);
    let reloads = 0;
    const watch = watch_config({ path, loaded_digest: () => loaded, reload: async () => { reloads += 1; } }, false);
    await watch.check();
    await watch.check();
    writeFileSync(path, "a: 1\n");
    unlinkSync(path);
    writeFileSync(path, "a: 1\n");
    await watch.check();
    expect(await watch.check()).toBe(false);
    expect(reloads).toBe(0);
  });

  it("follows a re-pointed symlink and keeps watching after a reload fails", async () => {
    const { folder, path } = setup("a: 1\n");
    const link = join(folder, "current.yaml");
    symlinkSync(path, link);
    const other = join(folder, "other.yaml");
    writeFileSync(other, "b: 2\n");
    const errors: unknown[] = [];
    const watch = watch_config({ path: link, loaded_digest: () => "old", reload: async () => { throw new Error("broken"); }, on_error: (error) => errors.push(error) }, false);
    const before = await config_fingerprint(link);
    await watch.check();
    await watch.check();
    const swap = join(folder, "swap.yaml");
    symlinkSync(other, swap);
    renameSync(swap, link);
    expect(await config_fingerprint(link)).not.toBe(before);
    await watch.check();
    expect(await watch.check()).toBe(true);
    expect((errors[0] as Error).message).toBe("broken");
  });

  it("ignores a file that is missing for a moment", async () => {
    const { path } = setup("a: 1\n");
    const watch = watch_config({ path, loaded_digest: () => null, reload: async () => {} }, false);
    unlinkSync(path);
    expect(await config_fingerprint(path)).toBeNull();
    expect(await watch.check()).toBe(false);
    expect(await watch.check()).toBe(false);
  });
});
