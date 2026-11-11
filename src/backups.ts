// Named backups of an app's data: the name says when each was taken and whether it was automatic, and daily ones keep a set number.

import type { Backup, BackupSchedule } from "./backup_protocol.ts";

export { backup_method_names, default_backup_schedule, type Backup, type BackupClient, type BackupMethods, type BackupSchedule } from "./backup_protocol.ts";

// ── Names ────────────────────────────────────────────────────────────────────

export interface BackupNaming {
  // Matches only names this naming writes, so a name from a page can never reach outside the backup folder.
  pattern: RegExp;
  // A repeat of 2 or more names another backup taken within the same second.
  name_for: (taken_at: Date, is_automatic: boolean, repeat?: number) => string;
  describe: (name: string, size_bytes: number) => Backup;
  // Which backup of its second the name is, 1 for the first; a naming without repeats always answers 1.
  repeat_of?: (name: string) => number;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Names such as tasks-2026-06-10T09-30-00Z-auto.db for the prefix "tasks" and the extension ".db", and
// tasks-2026-06-10T09-30-00Z-2.db for a second backup taken within the same second.
export function backup_naming(prefix: string, extension: string): BackupNaming {
  const pattern = new RegExp(`^${escaped(prefix)}-(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})Z(?:-([2-9]|[1-9]\\d+))?(-auto)?${escaped(extension)}$`);
  const matched = (name: string): RegExpExecArray => {
    const match = pattern.exec(name);
    if (!match) throw new Error(`not a backup name: ${name}`);
    return match;
  };
  return {
    pattern,
    name_for: (taken_at, is_automatic, repeat = 1) =>
      `${prefix}-${taken_at.toISOString().slice(0, 19).replaceAll(":", "-")}Z${repeat > 1 ? `-${repeat}` : ""}${is_automatic ? "-auto" : ""}${extension}`,
    describe: (name, size_bytes) => {
      const [, date, hours, minutes, seconds, , automatic] = matched(name);
      return { name, taken_at: `${date}T${hours}:${minutes}:${seconds}Z`, is_automatic: automatic !== undefined, size_bytes };
    },
    repeat_of: (name) => Number(matched(name)[5] ?? 1),
  };
}

// ── Keeping ──────────────────────────────────────────────────────────────────

// Where backups are kept, such as a folder on disk or one a phone app picked; each call may answer at once or later.
export interface BackupStore {
  list: () => Promise<{ name: string; size_bytes: number }[]> | { name: string; size_bytes: number }[];
  // Writes a new backup under the name and gives back its size in bytes.
  take: (name: string) => Promise<number> | number;
  remove: (name: string) => Promise<void> | void;
}

export interface Backups {
  naming: BackupNaming;
  // Newest first, leaving out any file the naming did not write.
  list: () => Promise<Backup[]>;
  // A second backup within the same second is taken too, under a name of its own, since a restore backs up the data
  // it replaces right after the backup it restores may have been taken.
  create: (is_automatic?: boolean) => Promise<Backup>;
  remove: (name: string) => Promise<void>;
  // Takes an automatic backup once the interval has passed since the last one and deletes the oldest automatic ones beyond the number to keep; ones made by hand stay.
  keep_automatic: (to_keep: number, interval_in_milliseconds?: number, now?: Date) => Promise<void>;
}

const day_in_milliseconds = 24 * 60 * 60 * 1000;

export function backups(naming: BackupNaming, store: BackupStore): Backups {
  const repeat_of = (backup: Backup): number => naming.repeat_of?.(backup.name) ?? 1;

  const list = async (): Promise<Backup[]> => (await store.list())
    .filter((file) => naming.pattern.test(file.name))
    .map((file) => naming.describe(file.name, file.size_bytes))
    .sort((first, second) => second.taken_at.localeCompare(first.taken_at) || repeat_of(second) - repeat_of(first));

  const remove = async (name: string): Promise<void> => {
    if (!naming.pattern.test(name)) throw new Error(`not a backup name: ${name}`);
    await store.remove(name);
  };

  const create = async (is_automatic = false, now = new Date()): Promise<Backup> => {
    const taken = await list();
    let name = naming.name_for(now, is_automatic);
    for (let repeat = 2; taken.some((backup) => backup.name === name); repeat++) {
      const next = naming.name_for(now, is_automatic, repeat);
      // A naming of an app's own that cannot name repeats keeps the backup already taken this second.
      if (next === name) return taken.find((backup) => backup.name === name)!;
      name = next;
    }
    return naming.describe(name, await store.take(name));
  };

  const keep_automatic = async (to_keep: number, interval_in_milliseconds = day_in_milliseconds, now = new Date()): Promise<void> => {
    const newest = (await list()).find((backup) => backup.is_automatic);
    if (!newest || now.getTime() - Date.parse(newest.taken_at) >= interval_in_milliseconds) await create(true, now);
    const automatic = (await list()).filter((backup) => backup.is_automatic);
    for (const backup of automatic.slice(Math.max(0, to_keep))) await remove(backup.name);
  };

  return { naming, list, create: (is_automatic) => create(is_automatic), remove, keep_automatic };
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export interface KeepBackingUpOptions {
  // How often to check whether a day has passed, since an app can stay open for days; an hour unless set.
  check_every_ms?: number;
  // A failed backup is reported here and never stops the app; logged unless set.
  on_error?: (error: unknown) => void;
}

// Takes the automatic backups now and on every check; check again after the schedule changes. Returns the function that stops it.
export function keep_backing_up(kept: Backups, schedule: () => BackupSchedule | Promise<BackupSchedule>, options: KeepBackingUpOptions = {}) {
  const on_error = options.on_error ?? ((error: unknown) => console.error("automatic backup failed:", error));
  const check = async (): Promise<void> => {
    try {
      const { automatic, to_keep } = await schedule();
      if (automatic) await kept.keep_automatic(to_keep);
    } catch (error) {
      on_error(error);
    }
  };
  void check();
  const timer = setInterval(() => void check(), options.check_every_ms ?? 60 * 60 * 1000);
  return { check, stop: () => clearInterval(timer) };
}
