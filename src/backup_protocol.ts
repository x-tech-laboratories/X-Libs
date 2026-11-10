// What a page and whatever keeps an app's backups say to each other: the desktop's main process, a server or the phone's page.

export interface Backup {
  name: string;
  // When it was taken, as an ISO time to the second.
  taken_at: string;
  is_automatic: boolean;
  size_bytes: number;
}

// Whether daily backups are taken, and how many of them are kept; ones made by hand always stay.
export interface BackupSchedule {
  automatic: boolean;
  to_keep: number;
}

export const default_backup_schedule: BackupSchedule = { automatic: true, to_keep: 14 };

export interface BackupMethods {
  list_backups: () => Promise<Backup[]>;
  create_backup: () => Promise<Backup>;
  // Backs up the current data first, so a restore can itself be undone.
  restore_backup: (name: string) => Promise<void>;
  remove_backup: (name: string) => Promise<void>;
  get_backup_schedule: () => BackupSchedule;
  set_backup_schedule: (schedule: BackupSchedule) => void;
}

export const backup_method_names = [
  "list_backups", "create_backup", "restore_backup", "remove_backup", "get_backup_schedule", "set_backup_schedule",
] as const satisfies readonly (keyof BackupMethods)[];

// The same calls as the page makes them, each answered later, as a bridge's client gives them.
export type BackupClient = { [Name in keyof BackupMethods]: (...args: Parameters<BackupMethods[Name]>) => Promise<Awaited<ReturnType<BackupMethods[Name]>>> };
