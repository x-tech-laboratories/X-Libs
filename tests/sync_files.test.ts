import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { file_response } from "../src/electron/file_protocol.ts";
import { folder_file_store } from "../src/node_file_store.ts";
import { hash_bytes, is_file_name, put_file } from "../src/sync_files.ts";

const bytes_of = (text: string) => new TextEncoder().encode(text);

let folders: string[] = [];

afterEach(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  folders = [];
});

function temp_store() {
  const folder = mkdtempSync(join(tmpdir(), "x-libs-files-"));
  folders.push(folder);
  return Object.assign(folder_file_store(join(folder, "files")), { folder: join(folder, "files") });
}

describe("file names", () => {
  it("names a file by the sha256 of its bytes", async () => {
    const name = await hash_bytes(bytes_of("abc"));
    expect(name).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(is_file_name(name)).toBe(true);
    expect(is_file_name("../media.db")).toBe(false);
  });

  it("keeps a file once in a folder and refuses a name that could leave it", async () => {
    const store = temp_store();
    const name = await put_file(store, bytes_of("cover"));
    await put_file(store, bytes_of("cover"));

    expect(await store.has(name)).toBe(true);
    expect(new TextDecoder().decode(await store.read(name))).toBe("cover");
    expect(readdirSync(store.folder)).toEqual([name]);
    expect(() => store.path_of("../media.db")).toThrow();
  });

  it("answers a file by its name for a desktop page's scheme", async () => {
    const store = temp_store();
    const name = await put_file(store, bytes_of("cover"));

    expect(await (await file_response(store, `x-cover://${name}`)).text()).toBe("cover");
    expect((await file_response(store, "x-cover://nothing")).status).toBe(404);
  });
});
