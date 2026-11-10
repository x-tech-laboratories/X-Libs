// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SyncStatus } from "../src/sync_protocol.ts";
import { SyncSettings } from "../src/web/react/sync_settings.tsx";

afterEach(cleanup);

const off: SyncStatus = { state: "off", server_url: "", last_synced_at: "", pending_changes: 0, error: "" };
const idle: SyncStatus = { ...off, state: "idle", server_url: "https://tasks.example.org/", pending_changes: 2 };

function fake_device(status: SyncStatus) {
  return {
    get_sync_status: vi.fn(async () => status),
    connect_sync: vi.fn(async () => idle),
    disconnect_sync: vi.fn(async () => off),
    sync_now: vi.fn(async () => idle),
  };
}

test("a device not syncing connects with the address and token, keeping the copy chosen", async () => {
  const device = fake_device(off);
  render(<SyncSettings device={device} placeholder="https://tasks.example.org/" />);

  expect(await screen.findByText("Not syncing")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "https://tasks.example.org/" } });
  fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "secret" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use the server's data" })));

  expect(device.connect_sync).toHaveBeenCalledWith("https://tasks.example.org/", "secret", "download");
  expect(await screen.findByRole("button", { name: "Sync now" })).toBeTruthy();
});

test("a syncing device shows its server and what is waiting, and rereads its status when told", async () => {
  const device = fake_device(idle);
  let listener = () => {};
  render(<SyncSettings device={device} subscribe={(next) => ((listener = next), () => {})} />);

  expect(await screen.findByText("https://tasks.example.org/")).toBeTruthy();
  expect(screen.getByText("2 changes waiting · last synced never")).toBeTruthy();
  await act(async () => listener());
  expect(device.get_sync_status).toHaveBeenCalledTimes(2);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop syncing" })));
  expect(device.disconnect_sync).toHaveBeenCalled();
});
