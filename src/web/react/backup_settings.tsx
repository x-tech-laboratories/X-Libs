// The settings rows for an app's backups: back up now, the daily schedule, and every backup newest first, each of
// which can be restored or deleted after a confirm through the page's Dialogs.

import { useEffect, useState, type ReactNode } from "react";
import type { Backup, BackupClient, BackupSchedule } from "../../backup_protocol.ts";
import { describe_error } from "../errors.ts";
import { size } from "../format.ts";
import { Switch, NumberField } from "./controls.tsx";
import { confirm_dialog } from "./dialog.tsx";
import { SettingRow } from "./layout.tsx";
import { toast } from "./toasts.tsx";

export interface BackupSettingsProps {
  device: BackupClient;
  // What the data is called in messages, such as "tasks, tags and settings".
  data_name?: string;
  // Runs once a backup is restored, such as reloading the page, since every value may have changed.
  on_restored?: () => void;
  // Rows the host adds above, such as the phone's backup folder or a button showing the desktop's.
  folder_row?: ReactNode;
  // False while backups cannot be taken, such as on a phone before a folder is picked.
  can_back_up?: boolean;
}

function taken_at_text(backup: Backup): string {
  return new Date(backup.taken_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export function BackupSettings({ device, data_name = "data", on_restored, folder_row, can_back_up = true }: BackupSettingsProps) {
  const [backups, set_backups] = useState<Backup[]>([]);
  const [schedule, set_schedule] = useState<BackupSchedule | null>(null);

  async function refresh(): Promise<void> {
    set_schedule(await device.get_backup_schedule());
    set_backups(await device.list_backups());
  }

  useEffect(() => {
    void refresh();
  }, [device]);

  async function attempt(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      toast(describe_error(error), { tone: "bad" });
    }
    await refresh();
  }

  // Turning daily backups on or keeping fewer can take or delete some, so the list is read again after.
  const change_schedule = (next: BackupSchedule) => attempt(() => device.set_backup_schedule(next));

  const restore = (backup: Backup) => confirm_dialog({
    title: "Restore backup",
    message: `Replace all current ${data_name} with the backup from ${taken_at_text(backup)}? The current data is backed up first.`,
    confirm_label: "Restore",
    busy_label: "Restoring…",
    danger: true,
    run: async () => {
      await device.restore_backup(backup.name);
      on_restored?.();
    },
  });

  const remove = (backup: Backup) => confirm_dialog({
    title: "Delete backup",
    message: `Delete the backup from ${taken_at_text(backup)}?`,
    confirm_label: "Delete",
    danger: true,
    run: () => attempt(() => device.remove_backup(backup.name)),
  });

  if (!schedule) return null;
  return (
    <>
      {folder_row}
      <SettingRow label="Back up now" hint={`Saves a copy of all ${data_name}, named by the time it was taken.`}>
        <button type="button" disabled={!can_back_up} onClick={() => void attempt(device.create_backup)}>Back up</button>
      </SettingRow>
      <SettingRow label="Back up daily" hint="Takes a backup once a day while the app is running. Backups made by hand are always kept." as_label>
        <Switch label="Back up daily" checked={schedule.automatic} on_change={(automatic) => void change_schedule({ ...schedule, automatic })} />
      </SettingRow>
      {schedule.automatic && (
        <SettingRow label="Daily backups to keep" hint="Older daily backups are deleted once there are more than this.">
          <NumberField label="Daily backups to keep" bare min={1} value={schedule.to_keep} on_change={(to_keep) => void change_schedule({ ...schedule, to_keep: Math.round(to_keep ?? 1) })} />
        </SettingRow>
      )}
      {backups.length === 0 && <p className="setting-hint">No backups yet.</p>}
      {backups.map((backup) => (
        <SettingRow key={backup.name} label={taken_at_text(backup)} hint={`${backup.is_automatic ? "Daily" : "By hand"} · ${size(backup.size_bytes)}`}>
          <button type="button" onClick={() => restore(backup)}>Restore</button>
          <button type="button" className="icon remove" aria-label={`Delete backup from ${taken_at_text(backup)}`} onClick={() => remove(backup)}>×</button>
        </SettingRow>
      ))}
    </>
  );
}
