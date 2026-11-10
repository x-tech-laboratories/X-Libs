// @vitest-environment jsdom
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import { sync_file_storage } from "../src/sync_file_storage.ts";
import { local_sync_storage } from "../src/web/sync_storage.ts";

const config = { server_url: "https://tasks.example.org/", token: "secret" };

test("the sync file keeps the server and token where only its user can read them, and goes on disconnect", () => {
  const file = join(mkdtempSync(join(tmpdir(), "sync-")), "sync.json");
  const storage = sync_file_storage(file, vi.fn());

  expect(storage.read_config()).toBeNull();
  storage.write_config(config);
  expect(storage.read_config()).toEqual(config);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  storage.remove_config();
  expect(storage.read_config()).toBeNull();
});

test("a phone keeps the server and token under its key in local storage", () => {
  const back_up = vi.fn();
  const storage = local_sync_storage("x-tasks-sync", back_up);

  storage.write_config(config);
  expect(JSON.parse(localStorage.getItem("x-tasks-sync")!)).toEqual(config);
  expect(storage.read_config()).toEqual(config);
  storage.remove_config();
  expect(storage.read_config()).toBeNull();
  void storage.back_up_before_download();
  expect(back_up).toHaveBeenCalled();
});
