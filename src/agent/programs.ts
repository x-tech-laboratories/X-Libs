// Runs one program with its arguments, never through a shell: each of its streams is shown as it comes, kept for the
// caller to read, both, or thrown away, and an abort signal stops it and, in its own process group, all it started.

// ── Imports ──────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { constants as fs_constants } from "node:fs";
import { access } from "node:fs/promises";
import { constants } from "node:os";

// ── Shapes ───────────────────────────────────────────────────────────────────

// Where shown output goes, such as a long run's output file.
export interface Sink {
  write(chunk: Buffer | string): void;
}

// Whether a stream is shown, kept for the caller, both, or thrown away.
export type StreamUse = "show" | "keep" | "both" | "drop";

export interface ProgramOptions {
  stdin?: string | null;
  stdout?: StreamUse;
  stderr?: StreamUse;
  // Where shown stdout and stderr go; nowhere unless set.
  out?: Sink;
  err?: Sink;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  // Stops the program once aborted.
  signal?: AbortSignal;
  // Whether the program gets a process group of its own, so stopping it stops everything it started.
  own_group?: boolean;
}

export interface ProgramResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// Give a stopped program this long to exit before it is killed outright.
export const kill_grace_in_milliseconds = 5000;

// A run keeps at most this much stdout, since it travels whole in one message.
export const stdout_limit_in_bytes = 32 * 1024 * 1024;

// Stderr is only ever an error message, so this much is plenty.
export const stderr_limit_in_bytes = 64 * 1024;

// The exit code a program that is not installed answers with, as a shell does.
export const not_installed_exit_code = 127;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Sends the signal to a process group, which may have ended already.
export function signal_group(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The process group is already gone.
  }
}

// Collects chunks up to a size, noting whether any were dropped.
export class BoundedBuffer {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  write(chunk: Buffer | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    const room = this.limit - this.size;
    if (room <= 0) {
      this.truncated = bytes.length > 0 || this.truncated;
      return;
    }
    const kept = bytes.length > room ? bytes.subarray(0, room) : bytes;
    if (kept !== bytes) this.truncated = true;
    this.chunks.push(kept);
    this.size += kept.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

const shows = (use: StreamUse) => use === "show" || use === "both";
const keeps = (use: StreamUse) => use === "keep" || use === "both";

// Where a program is on the PATH, or null when it is not there.
export async function on_path(name: string): Promise<string | null> {
  const folders = name.includes("/") ? [""] : (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const folder of folders) {
    const path = folder === "" ? name : `${folder}/${name}`;
    try {
      await access(path, fs_constants.X_OK);
      return path;
    } catch {
      // Not in this folder.
    }
  }
  return null;
}

// ── Running ──────────────────────────────────────────────────────────────────

// Runs the program to its end and never rejects: a program that cannot start answers 127 or -1 with why.
export function run_program(argv: readonly string[], options: ProgramOptions = {}): Promise<ProgramResult> {
  return new Promise((resolve) => {
    const stdout_use = options.stdout ?? "keep";
    const stderr_use = options.stderr ?? "keep";
    if (options.signal?.aborted) {
      resolve({ exit_code: -1, stdout: "", stderr: "Stopped before it started" });
      return;
    }
    const child = spawn(argv[0], argv.slice(1), {
      detached: options.own_group ?? false,
      stdio: [options.stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
      env: options.env,
      cwd: options.cwd,
    });
    if (options.stdin != null) {
      child.stdin!.on("error", () => {});
      child.stdin!.end(options.stdin);
    }
    const stdout = new BoundedBuffer(stdout_limit_in_bytes);
    const stderr = new BoundedBuffer(stderr_limit_in_bytes);
    child.stdout!.on("data", (chunk: Buffer) => {
      if (shows(stdout_use)) options.out?.write(chunk);
      if (keeps(stdout_use)) stdout.write(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (shows(stderr_use)) options.err?.write(chunk);
      if (keeps(stderr_use)) stderr.write(chunk);
    });

    let kill_timer: NodeJS.Timeout | undefined;
    const stop = () => {
      const signal = (name: NodeJS.Signals) => (options.own_group ? signal_group(child.pid, name) : child.kill(name));
      signal("SIGTERM");
      kill_timer = setTimeout(() => signal("SIGKILL"), kill_grace_in_milliseconds);
    };
    options.signal?.addEventListener("abort", stop, { once: true });

    let settled = false;
    const settle = (result: ProgramResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill_timer);
      options.signal?.removeEventListener("abort", stop);
      resolve(result);
    };
    child.on("error", (error: NodeJS.ErrnoException) => {
      const missing = error.code === "ENOENT";
      const message = missing ? `${argv[0]} is not installed on this host` : `Could not start ${argv[0]}: ${error.message}`;
      if (shows(stderr_use)) options.err?.write(`${message}\n`);
      settle({ exit_code: missing ? not_installed_exit_code : -1, stdout: "", stderr: message });
    });
    child.on("close", (code, signal) => {
      const exit_code = code ?? 128 + (signal === null ? 0 : constants.signals[signal]);
      settle({ exit_code, stdout: stdout.text(), stderr: stderr.text() });
    });
  });
}
