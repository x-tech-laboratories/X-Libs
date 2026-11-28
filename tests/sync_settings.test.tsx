// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { CertificateClient } from "../src/certificate_protocol.ts";
import type { PeerStatus, SyncDeviceClient, SyncStatus } from "../src/sync_protocol.ts";
import { SyncCertificatePrompt } from "../src/web/react/certificates.tsx";
import { Dialogs } from "../src/web/react/dialog.tsx";
import { SyncButton, SyncSettings } from "../src/web/react/sync_settings.tsx";
import { Toasts } from "../src/web/react/toasts.tsx";

afterEach(cleanup);

const off: SyncStatus = { state: "off", device: "ABCDEFGHIJKLMNOP", name: "Laptop", addresses: [], peers: [], last_synced_at: "", pending_changes: 0, error: "" };
const desktop: PeerStatus = { device: "QRSTUVWXYZ234567", name: "Desktop", addresses: ["http://192.168.1.5:3920/"], state: "idle", last_synced_at: "", error: "" };

function device_with(status: () => SyncStatus, overrides: Partial<SyncDeviceClient> = {}): SyncDeviceClient {
  return {
    get_sync_status: async () => status(),
    create_pairing_code: async () => ({ code: "x-sync:abc", expires_at: "2026-11-28T12:00:00Z" }),
    pair_device: async () => status(),
    remove_device: async () => status(),
    sync_now: async () => status(),
    ...overrides,
  };
}

test("pairs with the code another device shows, then lists that device", async () => {
  let status = off;
  const codes: string[] = [];
  const device = device_with(() => status, {
    pair_device: async (code) => {
      codes.push(code);
      status = { ...status, state: "idle", peers: [desktop] };
      return status;
    },
  });
  render(<><SyncSettings device={device} data_name="tasks" extra={<p>Let other devices connect</p>} /><Dialogs /></>);

  await waitFor(() => screen.getByText("This device: Laptop"));
  expect(screen.getByText("ABCDEFGH-IJKLMNOP · other devices cannot reach it; it reaches them")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show pairing code" })).toBeNull();
  expect(screen.getByText("Let other devices connect")).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("x-sync:…"), { target: { value: "x-sync:from-desktop" } });
  fireEvent.click(screen.getByRole("button", { name: "Pair" }));

  await waitFor(() => screen.getByText("Desktop"));
  expect(codes).toEqual(["x-sync:from-desktop"]);
});

test("shows a pairing code when other devices can reach it, and says why pairing failed", async () => {
  const status = { ...off, addresses: ["http://192.168.1.9:3920/"] };
  const device = device_with(() => status, { pair_device: async () => { throw new Error("Error invoking remote method 'pair_device': Error: the pairing code was used already"); } });
  render(<><SyncSettings device={device} /><Dialogs /><Toasts /></>);

  fireEvent.click(await screen.findByRole("button", { name: "Show pairing code" }));
  await waitFor(() => screen.getByText(/x-sync:abc/));
  fireEvent.change(screen.getByPlaceholderText("x-sync:…"), { target: { value: "x-sync:old" } });
  fireEvent.click(screen.getByRole("button", { name: "Pair" }));
  await waitFor(() => screen.getByText("the pairing code was used already"));
});

test("asks before removing a paired device, and syncs now", async () => {
  let status: SyncStatus = { ...off, state: "idle", peers: [{ ...desktop, state: "offline", error: "cannot be reached" }], pending_changes: 2 };
  const removed: string[] = [];
  let syncs = 0;
  const device = device_with(() => status, {
    remove_device: async (id) => ((removed.push(id), status = { ...status, peers: [] }), status),
    sync_now: async () => (syncs++, status),
  });
  let listener = () => {};
  render(<><SyncSettings device={device} subscribe={(next) => ((listener = next), () => {})} /><Dialogs /></>);

  await waitFor(() => screen.getByText(/2 changes waiting/));
  expect(screen.getByText(/cannot be reached/)).toBeTruthy();
  listener();
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
  await waitFor(() => expect(syncs).toBe(1));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
  await waitFor(() => expect(removed).toEqual([desktop.device]));
});

test("offers to trust a paired device's self-signed https certificate when syncing with it fails", async () => {
  let trusted = false;
  let syncs = 0;
  const server: PeerStatus = { ...desktop, name: "Server", addresses: ["https://nas.lan/api/"], state: "failed", error: "self-signed certificate" };
  const device = device_with(() => ({ ...off, state: "failed", peers: [server] }), { sync_now: async () => (syncs++, off) });
  const leaf = { subject: "CN=nas.lan", issuer: "CN=nas.lan", alt_names: [], valid_from: "2026-01-01T00:00:00Z", valid_to: "2027-01-01T00:00:00Z", fingerprint: "AB:CD", serial_number: "01", pem: "" };
  const certificates: CertificateClient = {
    check_certificate: async () => ({ origin: "https://nas.lan", host: "nas.lan", problems: ["self_signed"], reason: "DEPTH_ZERO_SELF_SIGNED_CERT", chain: [leaf], trusted }),
    trust_certificate: async () => ((trusted = true), []),
    list_trusted_certificates: async () => [],
    forget_certificate: async () => [],
  };
  render(<><SyncCertificatePrompt device={device} certificates={certificates} /><Dialogs /></>);

  fireEvent.click(await screen.findByRole("button", { name: "Trust this certificate" }));
  await waitFor(() => expect(syncs).toBe(1));
});

test("the sidebar button says sync is not set up while off and opens the settings, shows what is waiting, syncs on a click and opens the settings when sync fails", async () => {
  let status: SyncStatus = off;
  let syncs = 0;
  let opened = 0;
  const device = device_with(() => status, { sync_now: async () => ((syncs++, status = { ...status, pending_changes: 0 }), status) });
  let listener = () => {};
  render(<SyncButton device={device} subscribe={(next) => ((listener = next), () => {})} on_open_settings={() => opened++} />);
  fireEvent.click(await screen.findByRole("button", { name: /Sync not set up/ }));
  expect(opened).toBe(1);
  expect(syncs).toBe(0);

  status = { ...off, state: "idle", peers: [desktop], pending_changes: 3 };
  listener();
  fireEvent.click(await screen.findByRole("button", { name: /Synced/ }));
  expect(screen.getByText("3 pending")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("3 pending")).toBeNull());
  expect(syncs).toBe(1);

  status = { ...status, state: "failed", error: "not paired" };
  listener();
  fireEvent.click(await screen.findByRole("button", { name: /Sync failed/ }));
  expect(opened).toBe(2);
  expect(syncs).toBe(1);
});
