import type { Backup, BackupSchedule } from "./backup_protocol.ts";
export { backup_method_names, default_backup_schedule, type Backup, type BackupClient, type BackupMethods, type BackupSchedule } from "./backup_protocol.ts";
export interface BackupNaming {
    pattern: RegExp;
    name_for: (taken_at: Date, is_automatic: boolean) => string;
    describe: (name: string, size_bytes: number) => Backup;
}
export declare function backup_naming(prefix: string, extension: string): BackupNaming;
export interface BackupStore {
    list: () => Promise<{
        name: string;
        size_bytes: number;
    }[]> | {
        name: string;
        size_bytes: number;
    }[];
    take: (name: string) => Promise<number> | number;
    remove: (name: string) => Promise<void> | void;
}
export interface Backups {
    naming: BackupNaming;
    list: () => Promise<Backup[]>;
    create: (is_automatic?: boolean) => Promise<Backup>;
    remove: (name: string) => Promise<void>;
    keep_automatic: (to_keep: number, interval_in_milliseconds?: number, now?: Date) => Promise<void>;
}
export declare function backups(naming: BackupNaming, store: BackupStore): Backups;
export interface KeepBackingUpOptions {
    check_every_ms?: number;
    on_error?: (error: unknown) => void;
}
export declare function keep_backing_up(kept: Backups, schedule: () => BackupSchedule | Promise<BackupSchedule>, options?: KeepBackingUpOptions): {
    check: () => Promise<void>;
    stop: () => void;
};
