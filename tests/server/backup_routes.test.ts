import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import fastify, { type FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";

import { backup_naming } from "../../src/backups.ts";
import { json_backup_schedule, register_backup_routes } from "../../src/server/backup_routes.ts";
import { sqlite_backups, staged_restore_path } from "../../src/server/sqlite_backups.ts";
import { create_api } from "../../src/web/api.ts";
import { backup_client } from "../../src/web/backups.ts";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  vi.useRealTimers();
});

// A server on its own state database, and the page's client calling it through the app's injected requests.
async function serve() {
  const folder = mkdtempSync(join(tmpdir(), "backup-routes-"));
  const path = join(folder, "state.db");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE accounts (name TEXT); INSERT INTO accounts VALUES ('admin')");
  const on_schedule_change = vi.fn();
  const backups = sqlite_backups({ folder: () => join(folder, "backups"), naming: backup_naming("state", ".db"), database: () => database, database_path: () => path });
  app = fastify();
  const server = app;
  await server.register(async (api) => register_backup_routes(api, { backups, schedule: json_backup_schedule(join(folder, "backup-schedule.json")), on_schedule_change }), { prefix: "/api" });

  const fake_fetch = (async (input: string, init: RequestInit) => {
    const response = await server.inject({ url: input, method: init.method as "GET", headers: init.headers as Record<string, string>, payload: init.body as string | undefined });
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode });
  }) as unknown as typeof fetch;
  return { path, on_schedule_change, client: backup_client(create_api({ fetch: fake_fetch })) };
}

it("backs up, lists, keeps the schedule and stages a restore through the page's client", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T09:00:00Z"), toFake: ["Date"] });
  const { path, on_schedule_change, client } = await serve();

  const backup = await client.create_backup();
  expect((await client.list_backups()).map((each) => each.name)).toEqual([backup.name]);

  expect(await client.get_backup_schedule()).toEqual({ automatic: true, to_keep: 14 });
  await client.set_backup_schedule({ automatic: false, to_keep: 3 });
  expect(await client.get_backup_schedule()).toEqual({ automatic: false, to_keep: 3 });
  expect(on_schedule_change).toHaveBeenCalled();
  await expect(client.set_backup_schedule({ automatic: true, to_keep: 0 })).rejects.toThrow(/at least 1/);

  vi.setSystemTime(new Date("2026-11-10T10:00:00Z"));
  await client.restore_backup(backup.name);
  expect(staged_restore_path(path)).toSatisfy((staged: string) => new DatabaseSync(staged).prepare("SELECT name FROM accounts").get() !== undefined);

  await client.remove_backup(backup.name);
  expect((await client.list_backups()).map((each) => each.taken_at)).toEqual(["2026-11-10T10:00:00Z"]);
});
