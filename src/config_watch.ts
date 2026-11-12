// Reloads a config file when it changes. Every few seconds it reads a fingerprint of what the path points at (the real
// path through any symlink, its inode, change time and size), so a re-pointed symlink or a replaced file counts as a
// change; it waits one more check for the fingerprint to hold still, and reloads only when the content's hash differs
// from what was last loaded.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ConfigWatchOptions {
  path: string;
  // The sha256 of the content last loaded, or null when nothing is loaded.
  loaded_digest: () => string | null;
  reload: () => Promise<unknown>;
  // How often the file is checked; 3 seconds unless set.
  interval_in_milliseconds?: number;
  // Told when a reload throws; the watch keeps watching either way.
  on_error?: (error: unknown) => void;
}

export interface ConfigWatch {
  // One check, as the timer makes it; whether it reloaded.
  check(): Promise<boolean>;
  stop(): void;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const config_poll_in_milliseconds = 3000;

// ── Reading the file ─────────────────────────────────────────────────────────

// What the path points at and when it last changed, or null when it cannot be read.
export async function config_fingerprint(path: string): Promise<string | null> {
  try {
    const real = await realpath(path);
    const info = await stat(real, { bigint: true });
    return JSON.stringify([real, String(info.ino), String(info.mtimeNs), String(info.size)]);
  } catch {
    return null;
  }
}

// The sha256 of the file's content in hex, or null when it cannot be read.
export async function file_digest(path: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

// ── Watching ─────────────────────────────────────────────────────────────────

// Starts checking on a timer; `check` can also be called by hand, as a test does.
export function watch_config(options: ConfigWatchOptions, start_timer = true): ConfigWatch {
  let seen: string | null = null;
  let pending: string | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const check = async (): Promise<boolean> => {
    const current = await config_fingerprint(options.path);
    if (current === null || current === seen) {
      pending = null;
      return false;
    }
    if (current !== pending) {
      pending = current;
      return false;
    }
    seen = current;
    pending = null;
    if ((await file_digest(options.path)) === options.loaded_digest()) return false;
    try {
      await options.reload();
    } catch (error) {
      options.on_error?.(error);
    }
    return true;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void check().finally(schedule), options.interval_in_milliseconds ?? config_poll_in_milliseconds);
    timer.unref?.();
  };

  if (start_timer) schedule();

  return {
    check,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
