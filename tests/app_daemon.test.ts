import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start_daemon, type Daemon, type DaemonOptions } from "../src/app/daemon.ts";
import type { HostContext } from "../src/app/services.ts";
import { call_daemon, follow_daemon_events, is_answering } from "../src/local_daemon.ts";
import { sample_app } from "./app/sample_app.ts";

// ============================================================================
// Helpers
// ============================================================================

let folder: string;
let socket_path: string;
const running: Daemon[] = [];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "x-libs-app-daemon-"));
  socket_path = join(folder, "daemon.sock");
});

afterEach(async () => {
  for (const daemon of running.splice(0)) await daemon.shut_down();
  rmSync(folder, { recursive: true, force: true });
});

// A daemon on a throwaway database and socket, with a free port for other devices so tests never meet.
async function start(options: Partial<DaemonOptions> = {}): Promise<Daemon> {
  const daemon = await start_daemon(sample_app, { database_path: join(folder, "sample.db"), socket_path, on_stopped: () => undefined, default_peer_port: 0, ...options });
  running.push(daemon!);
  return daemon!;
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 400 && !(await check()); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
}

// ============================================================================
// Daemon
// ============================================================================

describe("app daemon", { timeout: 30_000 }, () => {
  it("answers the page's calls on its socket, as the server does", async () => {
    await start();

    await call_daemon(socket_path, "/api/call/add_note", ["Groceries"]);

    expect(await call_daemon(socket_path, "/api/call/list_notes", [])).toEqual([expect.objectContaining({ title: "Groceries" })]);
  });

  it("runs the app's services on the open database, around a restore, and stops them before the database closes", async () => {
    const seen: string[] = [];
    let context: HostContext | null = null;
    const daemon = await start({
      declared_file: join(folder, "declared.json"),
      services: (given) => {
        context = given;
        seen.push(`start ${given.kind}`);
        given.side_database("index").exec("CREATE TABLE IF NOT EXISTS words (word TEXT)");
        return {
          before_restore: () => void seen.push("before restore"),
          after_restore: () => void seen.push("after restore"),
          stop: () => void seen.push(`stop with ${(given.database().prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n} notes`),
        };
      },
    });
    await call_daemon(socket_path, "/api/call/add_note", ["Groceries"]);
    await call_daemon(socket_path, "/api/backups/create_backup", []);
    const backup = ((await call_daemon(socket_path, "/api/backups/list_backups", [])) as { name: string }[]).find((each) => !each.name.endsWith("-auto.db"));
    await call_daemon(socket_path, "/api/backups/restore_backup", [backup!.name]);

    await daemon.shut_down();

    expect(context).toMatchObject({ kind: "desktop", profile: folder, plugins_folder: join(folder, "plugins"), declared_file: join(folder, "declared.json"), config: {} });
    expect(seen).toEqual(["start desktop", "before restore", "after restore", "stop with 1 notes"]);
    expect(existsSync(join(folder, "sample-index.db"))).toBe(true);
  });

  it("answers this computer's own tables: sync, letting devices connect, backups, certificates and its settings", async () => {
    await start();

    expect(await call_daemon(socket_path, "/api/device/get_sync_status", [])).toMatchObject({ state: "off", peers: [] });
    expect(await call_daemon(socket_path, "/api/peer_listening/get_peer_listening", [])).toMatchObject({ on: false });
    expect(await call_daemon(socket_path, "/api/backups/list_backups", [])).toEqual(expect.any(Array));
    expect(await call_daemon(socket_path, "/api/certificates/list_trusted_certificates", [])).toEqual([]);
    await call_daemon(socket_path, "/api/daemon/set_desktop_setting", ["start_at_login", false]);
    expect(await call_daemon(socket_path, "/api/daemon/get_desktop_settings", [])).toEqual({ keep_running_in_background: true, start_at_login: false });
  });

  it("tells other windows of a change, but not the one that made it", async () => {
    await start();
    const seen: string[] = [];
    let client_id = "";
    const stop = follow_daemon_events(socket_path, "/api/events", (event, data) => {
      if (event === "hello") client_id = data;
      else seen.push(event);
    });
    await until(() => client_id !== "");

    await call_daemon(socket_path, "/api/call/add_note", ["Mine"], { "x-client-id": client_id });
    await call_daemon(socket_path, "/api/call/add_note", ["Another window's"]);
    await until(() => seen.length > 0);
    stop();

    expect(seen).toEqual(["changed"]);
  });

  it("leaves a second daemon on the same database out, since the first already answers", async () => {
    await start();

    expect(await start_daemon(sample_app, { database_path: join(folder, "sample.db"), socket_path, on_stopped: () => undefined })).toBeNull();
  });

  it("stops when asked, and only once", async () => {
    const on_stopped = vi.fn();
    const daemon = await start({ on_stopped });

    await call_daemon(socket_path, "/api/daemon/stop_daemon", []);
    await until(() => on_stopped.mock.calls.length > 0);
    await daemon.shut_down();

    expect(on_stopped).toHaveBeenCalledTimes(1);
    expect(await is_answering(socket_path)).toBe(false);
  });

  it("stops a while after its last window closed when it is not to keep running", async () => {
    const on_stopped = vi.fn();
    await start({ on_stopped, unused_exit_ms: 100, unused_check_ms: 20 });

    await call_daemon(socket_path, "/api/daemon/set_desktop_setting", ["keep_running_in_background", false]);
    await until(() => on_stopped.mock.calls.length > 0);

    expect(on_stopped).toHaveBeenCalledTimes(1);
  });

  it("runs as a program of its own from the environment, as the window starts it", async () => {
    const program = spawn(process.execPath, ["tests/app/daemon_main.ts"], { env: { ...process.env, X_SAMPLE_DB: join(folder, "sample.db"), X_SAMPLE_SOCKET: socket_path }, stdio: "ignore" });
    await until(() => is_answering(socket_path));

    await call_daemon(socket_path, "/api/daemon/stop_daemon", []);

    expect(await new Promise((resolve) => program.once("exit", resolve))).toBe(0);
  });

  it("will not run without a database named", async () => {
    const program = spawn(process.execPath, ["tests/app/daemon_main.ts"], { env: { ...process.env, X_SAMPLE_DB: "" }, stdio: "ignore" });

    expect(await new Promise((resolve) => program.once("exit", resolve))).toBe(2);
  });
});
