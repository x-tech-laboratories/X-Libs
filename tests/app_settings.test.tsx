// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageApi } from "../src/app/protocol.ts";
import { set_page_api } from "../src/app/web/page.ts";
import { SettingsView, type AppPages } from "../src/app/web/settings_page.tsx";
import type { BackupClient } from "../src/backups.ts";
import { Dialogs } from "../src/web/react/dialog.tsx";
import { SettingRow } from "../src/web/react/layout.tsx";
import type { SyncDeviceClient } from "../src/sync_protocol.ts";
import { sample_app } from "./app/sample_app.ts";

afterEach(cleanup);

// ============================================================================
// Helpers
// ============================================================================

const pages: AppPages = {
  app: sample_app,
  pages: [
    { id: "notes", label: "Notes", view: () => <p>Every note</p>, settings: () => [{ id: "sorting", heading: "Sorting", content: <SettingRow label="Sort by">Title</SettingRow> }] },
    { id: "trash", label: "Trash", view: () => <p>Thrown away</p> },
  ],
  general_settings: ({ settings, set_setting }) => [
    { id: "money", heading: "Money", content: <button type="button" onClick={() => void set_setting("currency", "JMD")}>Use {String(settings.currency)}</button> },
  ],
};

function fake_calls(saved: Record<string, unknown>): PageApi["calls"] {
  return {
    get_settings: vi.fn(async () => ({ ...saved })),
    set_setting: vi.fn(async (key: string, value: unknown) => void (saved[key] = value)),
  } as unknown as PageApi["calls"];
}

const off = { state: "off", device: "d1", name: "This device", addresses: [], peers: [], last_synced_at: "", pending_changes: 0, error: "" } as const;

function fake_device(): SyncDeviceClient {
  return { get_sync_status: vi.fn(async () => off), create_pairing_code: vi.fn(), pair_device: vi.fn(), remove_device: vi.fn(), sync_now: vi.fn() } as unknown as SyncDeviceClient;
}

// ============================================================================
// Settings
// ============================================================================

describe("app settings", () => {
  it("shows the app's general sections and each page's own, and saves through the page's calls", async () => {
    const calls = fake_calls({ currency: "USD" });
    set_page_api({ host: "web", calls, device: null, backups: null, on_change: () => () => undefined });
    render(<SettingsView pages={pages} />);

    fireEvent.click(await screen.findByRole("button", { name: "Use USD" }));

    await waitFor(() => expect(calls.set_setting).toHaveBeenCalledWith("currency", "JMD"));
    expect(screen.getAllByText("Sorting").length).toBeGreaterThan(0);
    expect(screen.queryByText("Trash")).toBeNull();
    expect(screen.queryByText("Sync")).toBeNull();
  });

  it("offers sync on a device, in the app's words", async () => {
    const device = fake_device();
    set_page_api({ host: "desktop", calls: fake_calls({}), device, backups: null, on_change: () => () => undefined });
    render(<><SettingsView pages={pages} /><Dialogs /></>);

    expect(await screen.findByText("Keep this device's notes alike with your other devices and your X-Sample server.")).toBeTruthy();
    await waitFor(() => expect(device.get_sync_status).toHaveBeenCalled());
  });

  it("shows the server's sync and backups to an admin in a browser, and not to anyone else", async () => {
    const backups = { list_backups: vi.fn(async () => []), get_backup_schedule: vi.fn(async () => ({ automatic: true, to_keep: 14 })) } as unknown as BackupClient;
    set_page_api({ host: "web", calls: fake_calls({}), device: fake_device(), backups, on_change: () => () => undefined });
    const { unmount } = render(<SettingsView pages={pages} is_admin={false} />);
    expect((await screen.findAllByText("Money")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Keep the server's notes alike with the devices paired with it.")).toBeNull();
    unmount();

    render(<SettingsView pages={pages} is_admin />);

    expect(await screen.findByText("Keep the server's notes alike with the devices paired with it.")).toBeTruthy();
    expect(screen.getByText("The server's notes, kept in its data folder.")).toBeTruthy();
  });

  it("lists the daemons a desktop window can work on, and its own settings", async () => {
    const view = { connections: [{ id: "local", name: "This computer", kind: "local" as const, address: "", user: "" }], current: "local" };
    const connections = { list_connections: vi.fn(async () => view), add_connection: vi.fn(), rename_connection: vi.fn(), remove_connection: vi.fn(), choose_connection: vi.fn() };
    const desktop = {
      get_desktop_settings: vi.fn(async () => ({ show_tray_icon: true, keep_running_in_background: true, start_at_login: true })),
      set_desktop_setting: vi.fn(async () => undefined),
      quit_completely: vi.fn(async () => undefined),
    };
    set_page_api({ host: "desktop", calls: fake_calls({}), device: null, backups: null, connections, desktop, on_change: () => () => undefined });
    render(<><SettingsView pages={pages} /><Dialogs /></>);

    expect(await screen.findByText("This computer")).toBeTruthy();
    fireEvent.click(await screen.findByRole("switch", { name: "Keep running in the background" }));
    fireEvent.click(screen.getByRole("button", { name: "Quit completely" }));

    await waitFor(() => expect(desktop.set_desktop_setting).toHaveBeenCalledWith("keep_running_in_background", false));
    expect(desktop.quit_completely).toHaveBeenCalledOnce();
    expect(screen.getByText("Starts X-Sample in the background when you log in, without opening its window.")).toBeTruthy();
  });

  it("shows the app's own MCP endpoint where the desktop app serves one", async () => {
    const local_mcp = {
      get_local_mcp_settings: vi.fn(async () => ({ enabled: false, port: 7792, require_token: false })),
      set_local_mcp_settings: vi.fn(async () => undefined),
      get_local_mcp_status: vi.fn(async () => ({ listening: false, port: 7792, error: null })),
    };
    set_page_api({ host: "desktop", calls: fake_calls({}), device: null, backups: null, local_mcp, on_change: () => () => undefined } as never);
    render(<><SettingsView pages={pages} /><Dialogs /></>);

    expect((await screen.findAllByText("MCP server")).length).toBeGreaterThan(0);
    await waitFor(() => expect(local_mcp.get_local_mcp_settings).toHaveBeenCalled());
  });

  it("shows the tray switch and the app's own desktop switches, saving each on this computer", async () => {
    const desktop = {
      get_desktop_settings: vi.fn(async () => ({ show_tray_icon: true, keep_running_in_background: true, start_at_login: true, notify_inbox: true })),
      set_desktop_setting: vi.fn(async () => undefined),
      quit_completely: vi.fn(async () => undefined),
    };
    set_page_api({ host: "desktop", calls: fake_calls({}), device: null, backups: null, desktop, on_change: () => () => undefined });
    const own: AppPages = { ...pages, app: { ...pages.app, desktop_settings: { notify_inbox: { default: true, label: "Inbox notifications", hint: "Says when something waits." } } } };
    render(<><SettingsView pages={own} /><Dialogs /></>);

    fireEvent.click(await screen.findByRole("switch", { name: "Show the tray icon" }));
    fireEvent.click(screen.getByRole("switch", { name: "Inbox notifications" }));

    await waitFor(() => expect(desktop.set_desktop_setting).toHaveBeenCalledWith("notify_inbox", false));
    expect(desktop.set_desktop_setting).toHaveBeenCalledWith("show_tray_icon", false);
    expect(screen.getByText("Says when something waits.")).toBeTruthy();
  });

  it("asks a phone for a backup folder before it backs up, and lists backups once one is picked", async () => {
    const backups = {
      list_backups: vi.fn(async () => []),
      create_backup: vi.fn(),
      restore_backup: vi.fn(),
      remove_backup: vi.fn(),
      get_backup_schedule: vi.fn(async () => ({ automatic: true, to_keep: 14 })),
      set_backup_schedule: vi.fn(),
    } as unknown as BackupClient;
    let folder = "";
    const backup_folder = { name: vi.fn(async () => folder), choose: vi.fn(async () => (folder = "Documents")) };
    set_page_api({ host: "android", calls: fake_calls({}), device: fake_device(), backups, backup_folder, on_change: () => () => undefined });
    render(<><SettingsView pages={pages} /><Dialogs /></>);

    fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));

    expect(await screen.findByText("Documents")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change folder…" })).toBeTruthy();
    await waitFor(() => expect(backups.list_backups).toHaveBeenCalled());
  });
});
