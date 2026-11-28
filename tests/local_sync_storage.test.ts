// @vitest-environment jsdom
import { expect, test, vi } from "vitest";

import { create_identity } from "../src/sync_seal.ts";
import { local_sync_storage } from "../src/web/sync_storage.ts";

const identity = create_identity();
const peer = { device: "OTHER", public_key: identity.public_key, name: "Laptop", addresses: [], updated_at: 1, removed: false };

test("a phone keeps its keys and paired devices under its key in local storage", () => {
  const back_up = vi.fn();
  const storage = local_sync_storage({ key: "x-tasks-sync-peers", back_up_before_replace: back_up });
  expect(storage.read_identity()).toBeNull();

  storage.write_identity(identity);
  storage.write_peers([peer]);
  expect(JSON.parse(localStorage.getItem("x-tasks-sync-peers")!)).toEqual({ identity, peers: [peer] });
  expect(storage.read_identity()).toEqual(identity);
  expect(storage.read_peers()).toEqual([peer]);

  localStorage.setItem("x-tasks-sync-peers", "not json");
  expect(storage.read_peers()).toEqual([]);
  void storage.back_up_before_replace();
  expect(back_up).toHaveBeenCalled();
});
