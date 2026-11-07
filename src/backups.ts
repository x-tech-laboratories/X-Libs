// Named backups of an app's data: the name says when each was taken and whether it was automatic, and daily ones keep a set number.

export interface Backup {
  name: string;
  // When it was taken, as an ISO time to the second.
  taken_at: string;
  is_automatic: boolean;
  size_bytes: number;
}

// ── Names ────────────────────────────────────────────────────────────────────

export interface BackupNaming {
  // Matches only names this naming writes, so a name from a page can never reach outside the backup folder.
  pattern: RegExp;
  name_for: (taken_at: Date, is_automatic: boolean) => string;
  describe: (name: string, size_bytes: number) => Backup;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Names such as tasks-2026-06-10T09-30-00Z-auto.db for the prefix "tasks" and the extension ".db".
export function backup_naming(prefix: string, extension: string): BackupNaming {
  const pattern = new RegExp(`^${escaped(prefix)}-(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})Z(-auto)?${escaped(extension)}$`);
  return {
    pattern,
    name_for: (taken_at, is_automatic) => `${prefix}-${taken_at.toISOString().slice(0, 19).replaceAll(":", "-")}Z${is_automatic ? "-auto" : ""}${extension}`,
    describe: (name, size_bytes) => {
      const match = pattern.exec(name);
      if (!match) throw new Error(`not a backup name: ${name}`);
      const [, date, hours, minutes, seconds, automatic] = match;
      return { name, taken_at: `${date}T${hours}:${minutes}:${seconds}Z`, is_automatic: automatic !== undefined, size_bytes };
    },
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
  // A second backup within the same second keeps the first, since nothing much can have changed between them.
  create: (is_automatic?: boolean) => Promise<Backup>;
  remove: (name: string) => Promise<void>;
  // Takes an automatic backup once the interval has passed since the last one and deletes the oldest automatic ones beyond the number to keep; ones made by hand stay.
  keep_automatic: (to_keep: number, interval_in_milliseconds?: number, now?: Date) => Promise<void>;
}

const day_in_milliseconds = 24 * 60 * 60 * 1000;

export function backups(naming: BackupNaming, store: BackupStore): Backups {
  const list = async (): Promise<Backup[]> => (await store.list())
    .filter((file) => naming.pattern.test(file.name))
    .map((file) => naming.describe(file.name, file.size_bytes))
    .sort((first, second) => second.taken_at.localeCompare(first.taken_at));

  const remove = async (name: string): Promise<void> => {
    if (!naming.pattern.test(name)) throw new Error(`not a backup name: ${name}`);
    await store.remove(name);
  };

  const create = async (is_automatic = false, now = new Date()): Promise<Backup> => {
    const name = naming.name_for(now, is_automatic);
    const existing = (await list()).find((backup) => backup.name === name);
    return existing ?? naming.describe(name, await store.take(name));
  };

  const keep_automatic = async (to_keep: number, interval_in_milliseconds = day_in_milliseconds, now = new Date()): Promise<void> => {
    const newest = (await list()).find((backup) => backup.is_automatic);
    if (!newest || now.getTime() - Date.parse(newest.taken_at) >= interval_in_milliseconds) await create(true, now);
    const automatic = (await list()).filter((backup) => backup.is_automatic);
    for (const backup of automatic.slice(Math.max(0, to_keep))) await remove(backup.name);
  };

  return { naming, list, create: (is_automatic) => create(is_automatic), remove, keep_automatic };
}
