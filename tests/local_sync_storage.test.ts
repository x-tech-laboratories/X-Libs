// @vitest-environment jsdom
import { expect, test, vi } from "vitest";

import { local_sync_storage } from "../src/web/sync_storage.ts";

const config = { server_url: "https://tasks.example.org/", token: "secret" };

test("a phone keeps the server and token under its key in local storage", () => {
  const back_up = vi.fn();
  const storage = local_sync_storage({ key: "x-tasks-sync", back_up_before_download: back_up });

  storage.write_config(config);
  expect(JSON.parse(localStorage.getItem("x-tasks-sync")!)).toEqual(config);
  expect(storage.read_config()).toEqual(config);
  storage.remove_config();
  expect(storage.read_config()).toBeNull();
  void storage.back_up_before_download();
  expect(back_up).toHaveBeenCalled();
});
