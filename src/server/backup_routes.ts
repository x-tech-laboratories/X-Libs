// A server's backups as routes the page's BackupSettings calls through web/backups: the list, backing up now, the
// daily schedule, restoring and deleting. Who may call them is the app's own sign-in guard's to decide.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FastifyInstance } from "fastify";

import { default_backup_schedule, type BackupSchedule } from "../backup_protocol.ts";
import type { Backups } from "../backups.ts";

// ── Schedule ─────────────────────────────────────────────────────────────────

export interface BackupScheduleStore {
  get: () => BackupSchedule;
  set: (schedule: BackupSchedule) => void;
}

// The schedule in a JSON file, such as beside the server's database; the default schedule until one is saved.
export function json_backup_schedule(file: string): BackupScheduleStore {
  return {
    get: () => (existsSync(file) ? { ...default_backup_schedule, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<BackupSchedule>) } : default_backup_schedule),
    set: (schedule) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(schedule, null, 2));
    },
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export interface BackupRoutesOptions {
  backups: Backups & { restore: (name: string) => Promise<void> };
  schedule: BackupScheduleStore;
  // Runs after the schedule changes, such as checking at once whether a daily backup is due.
  on_schedule_change?: () => void;
  // Under the plugin's prefix; "/backups" unless set.
  prefix?: string;
}

function is_schedule(value: unknown): value is BackupSchedule {
  const schedule = value as BackupSchedule | null;
  return typeof schedule?.automatic === "boolean" && Number.isInteger(schedule.to_keep) && schedule.to_keep >= 1;
}

export function register_backup_routes(api: FastifyInstance, options: BackupRoutesOptions): void {
  const prefix = options.prefix ?? "/backups";
  const { backups, schedule } = options;

  api.get(prefix, () => backups.list());
  api.post(prefix, () => backups.create());
  api.get(`${prefix}/schedule`, () => schedule.get());
  api.put(`${prefix}/schedule`, async (request, reply) => {
    if (!is_schedule(request.body)) return reply.code(400).send({ error: "A schedule is { automatic, to_keep } with to_keep at least 1." });
    schedule.set({ automatic: request.body.automatic, to_keep: request.body.to_keep });
    options.on_schedule_change?.();
    return reply.code(204).send();
  });
  api.post<{ Params: { name: string } }>(`${prefix}/:name/restore`, async (request, reply) => {
    await backups.restore(request.params.name);
    return reply.code(204).send();
  });
  api.delete<{ Params: { name: string } }>(`${prefix}/:name`, async (request, reply) => {
    await backups.remove(request.params.name);
    return reply.code(204).send();
  });
}
