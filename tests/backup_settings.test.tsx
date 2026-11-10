// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { Backup, BackupSchedule } from "../src/backups.ts";
import { BackupSettings } from "../src/web/react/backup_settings.tsx";
import { Dialogs } from "../src/web/react/dialog.tsx";

afterEach(cleanup);

const by_hand: Backup = { name: "tasks-2026-11-10T09-30-00Z.db", taken_at: "2026-11-10T09:30:00Z", is_automatic: false, size_bytes: 2048 };

function fake_device() {
  let schedule: BackupSchedule = { automatic: true, to_keep: 14 };
  return {
    list_backups: vi.fn(async () => [by_hand]),
    create_backup: vi.fn(async () => by_hand),
    restore_backup: vi.fn(async () => {}),
    remove_backup: vi.fn(async () => {}),
    get_backup_schedule: vi.fn(async () => schedule),
    set_backup_schedule: vi.fn(async (next: BackupSchedule) => void (schedule = next)),
  };
}

test("backing up now and turning daily backups off go to the device and read the list again", async () => {
  const device = fake_device();
  render(<BackupSettings device={device} data_name="tasks" />);

  const back_up = await screen.findByRole("button", { name: "Back up" });
  await act(async () => fireEvent.click(back_up));
  expect(device.create_backup).toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Back up daily" })));
  expect(device.set_backup_schedule).toHaveBeenCalledWith({ automatic: false, to_keep: 14 });
  expect(screen.queryByText("Daily backups to keep")).toBeNull();
});

test("a backup is restored only after the confirm, and the page hears of it", async () => {
  const device = fake_device();
  const on_restored = vi.fn();
  render(<><BackupSettings device={device} data_name="tasks" on_restored={on_restored} /><Dialogs /></>);

  expect(await screen.findByText(/By hand/)).toBeTruthy();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Restore" })));
  expect(device.restore_backup).not.toHaveBeenCalled();
  // The dialog's own Restore button comes after the row's.
  await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Restore" }).at(-1)!));
  expect(device.restore_backup).toHaveBeenCalledWith(by_hand.name);
  expect(on_restored).toHaveBeenCalled();
});
