// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { SyncCredentials, SyncDeviceClient, SyncStatus } from "../src/sync_protocol.ts";
import { Dialogs } from "../src/web/react/dialog.tsx";
import { SyncSettings } from "../src/web/react/sync_settings.tsx";

afterEach(cleanup);

const off: SyncStatus = { state: "off", server_url: "", user: "", last_synced_at: "", pending_changes: 0, error: "" };

test("asks before replacing, signs the device in, asks for the code when the server does, then shows who it syncs as", async () => {
  const tries: (SyncCredentials | string | null)[] = [];
  let status = off;
  const device: SyncDeviceClient = {
    get_sync_status: async () => status,
    connect_sync: async (server_url, credentials) => {
      tries.push(credentials);
      if (typeof credentials !== "object" || !credentials?.code) throw new Error("Error invoking remote method 'connect_sync': Error: Enter the code from your authenticator app.");
      status = { ...status, state: "idle", server_url, user: "ada" };
      return status;
    },
    disconnect_sync: async () => off,
    sync_now: async () => status,
  };
  render(<><SyncSettings device={device} data_name="tasks" /><Dialogs /></>);

  await waitFor(() => screen.getByLabelText("Server address"));
  fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "https://sync.example.org/" } });
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Use the server's tasks" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use the server's" }));
  await waitFor(() => screen.getByLabelText("Code from your authenticator app, or a recovery code"));
  fireEvent.change(screen.getByLabelText("Code from your authenticator app, or a recovery code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Use the server's tasks" }));

  await waitFor(() => screen.getByText("Signed in as ada"));
  expect(tries).toEqual([{ name: "ada", password: "secret" }, { name: "ada", password: "secret", code: "123456" }]);
  expect(screen.getByRole("button", { name: "Stop syncing" })).toBeTruthy();
});

test("a syncing device shows its server and what is waiting, rereads its status when told, and stops", async () => {
  const idle: SyncStatus = { ...off, state: "idle", server_url: "https://tasks.example.org/", pending_changes: 2 };
  let reads = 0;
  let stopped = false;
  const device: SyncDeviceClient = {
    get_sync_status: async () => (reads++, idle),
    connect_sync: async () => idle,
    disconnect_sync: async () => ((stopped = true), off),
    sync_now: async () => idle,
  };
  let listener = () => {};
  render(<SyncSettings device={device} subscribe={(next) => ((listener = next), () => {})} />);

  await waitFor(() => screen.getByText("https://tasks.example.org/ · 2 changes waiting · last synced never"));
  listener();
  await waitFor(() => expect(reads).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "Stop syncing" }));
  await waitFor(() => expect(stopped).toBe(true));
});
