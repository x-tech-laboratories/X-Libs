// Media played through mpv, run as a program of its own and driven over its JSON IPC socket, so an app gets gapless
// playback, every format and precise seeking without linking a native library. `MpvProcess` is the program and its
// socket: started on first use, restarted by the next command after it fails or exits, its properties observed and its
// events heard. `MpvEngine` plays one file at a time on it behind `PlaybackEngine`, which knows files and nothing of
// tracks, queues or libraries, so an app's own player decides what plays and can be tested on `NullEngine`.

// ── Imports ──────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { on_path } from "./agent/programs.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

// A unix socket's path holds a little over a hundred bytes, so a longer one moves to /tmp.
export const socket_path_limit = 100;

// How long mpv has to open its socket before its start counts as failed.
export const start_timeout_in_milliseconds = 10_000;

// How long a closing mpv has to quit before it is stopped outright.
export const quit_grace_in_milliseconds = 2_000;

// How often the socket is tried while mpv is still making it.
const connect_retry_in_milliseconds = 40;

// ── Finding mpv ──────────────────────────────────────────────────────────────

// The first of the paths or names given that can run, such as a setting and then an environment variable, else the
// mpv on the PATH; null when there is none.
export async function find_mpv(...overrides: (string | null | undefined)[]): Promise<string | null> {
  for (const override of overrides) {
    const found = override ? await on_path(override) : null;
    if (found) return found;
  }
  return on_path("mpv");
}

// ── The process ──────────────────────────────────────────────────────────────

export interface MpvProcessOptions {
  // An mpv to run before the one on the PATH, by path or name.
  binary?: string | null;
  // More of mpv's options, such as "--no-video".
  args?: readonly string[];
  // Each line of mpv's warnings and errors, which otherwise go nowhere.
  on_log?: (line: string) => void;
  start_timeout_in_milliseconds?: number;
  // The start of the socket's file name, such as the app's name.
  socket_name?: string;
  // The folder the socket is made in; the system's temporary folder unless set.
  socket_folder?: string;
}

// One of mpv's events, such as `{ event: "end-file", reason: "eof" }`.
export interface MpvEvent {
  event: string;
  [field: string]: unknown;
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Observer {
  property: string;
  listener: (value: unknown) => void;
}

// Each process gets a socket of its own, even several in one app.
let process_count = 0;

// Where the socket goes: the folder asked for, or /tmp when a path there would be too long for a socket.
export function socket_path_in(folder: string, name: string): string {
  const path = join(folder, name);
  return Buffer.byteLength(path) <= socket_path_limit ? path : join("/tmp", name);
}

export class MpvProcess {
  readonly socket_path: string;
  private readonly options: MpvProcessOptions;
  private child: ChildProcess | null = null;
  private socket: Socket | null = null;
  private buffer = "";
  private next_request_id = 1;
  private readonly waiters = new Map<number, Waiter>();
  private next_observer_id = 1;
  private readonly observers = new Map<number, Observer>();
  // Whether mpv has started and been asked for every observed property, so new ones are asked for at once.
  private observing = false;
  private readonly event_listeners = new Set<(event: MpvEvent) => void>();
  private readonly stop_listeners = new Set<(reason: string, clean: boolean) => void>();
  // The start under way or done; null before the first command and after mpv fails or exits.
  private ready: Promise<void> | null = null;
  // Settles once the last mpv started has exited.
  private exited: Promise<void> = Promise.resolve();
  private last_log = "";
  private closed = false;

  constructor(options: MpvProcessOptions = {}) {
    this.options = options;
    process_count += 1;
    const name = `${options.socket_name ?? "x-libs-mpv"}-${process.pid}-${process_count}.sock`;
    this.socket_path = socket_path_in(options.socket_folder ?? tmpdir(), name);
  }

  // Whether mpv is running and answering now.
  get running(): boolean {
    return this.observing && this.socket !== null;
  }

  // mpv's last warning or error line, which says why a start or a file failed.
  get last_log_line(): string {
    return this.last_log;
  }

  // Starts mpv unless it is running or starting; a failed start rejects with why and the next call tries again.
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("mpv was closed"));
    if (!this.ready) {
      this.ready = this.launch().catch((error: Error) => {
        this.ready = null;
        this.halt();
        this.tell_stopped(error.message, false);
        throw error;
      });
    }
    return this.ready;
  }

  // Runs one of mpv's commands, such as `command("loadfile", path)`, starting mpv first when needed.
  async command(...args: unknown[]): Promise<unknown> {
    await this.start();
    return this.send(args);
  }

  get_property(name: string): Promise<unknown> {
    return this.command("get_property", name);
  }

  async set_property(name: string, value: unknown): Promise<void> {
    await this.command("set_property", name, value);
  }

  // Hears a property's value now and whenever it changes, again after a restart, until the returned function is called.
  observe(property: string, listener: (value: unknown) => void): () => void {
    const id = this.next_observer_id++;
    this.observers.set(id, { property, listener });
    if (this.observing) this.send(["observe_property", id, property]).catch(() => undefined);
    return () => {
      this.observers.delete(id);
      if (this.observing) this.send(["unobserve_property", id]).catch(() => undefined);
    };
  }

  // Hears every event mpv sends, such as "end-file" or "file-loaded".
  on_event(listener: (event: MpvEvent) => void): () => void {
    this.event_listeners.add(listener);
    return () => void this.event_listeners.delete(listener);
  }

  // Hears why mpv stopped when it fails to start or exits on its own, clean when it quit by itself without an error,
  // such as when its window is closed; the next command starts it again.
  on_stop(listener: (reason: string, clean: boolean) => void): () => void {
    this.stop_listeners.add(listener);
    return () => void this.stop_listeners.delete(listener);
  }

  // Asks mpv to quit, stops it outright if it lingers, and waits until it has gone; later commands are refused.
  async close(): Promise<void> {
    this.closed = true;
    this.event_listeners.clear();
    this.stop_listeners.clear();
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<boolean>((resolve) => child.once("close", () => resolve(true)));
      const within_grace = () => Promise.race([exited, sleep(quit_grace_in_milliseconds).then(() => false)]);
      if (this.socket) this.send(["quit"]).catch(() => undefined);
      else child.kill("SIGTERM");
      if (!(await within_grace())) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    this.halt();
  }

  // ── Starting ───────────────────────────────────────────────────────────────

  private async launch(): Promise<void> {
    const binary = await find_mpv(this.options.binary);
    if (!binary) {
      const where = this.options.binary ? ` at ${this.options.binary} or` : "";
      throw new Error(`mpv was not found${where} on the PATH; install mpv or set its path`);
    }
    if (this.closed) throw new Error("mpv was closed");
    await this.wait_for_previous();

    // A socket file left behind would stop mpv from making its own.
    rmSync(this.socket_path, { force: true });
    this.last_log = "";
    const child = spawn(binary, [
      "--idle=yes",
      "--msg-level=all=warn",
      `--input-ipc-server=${this.socket_path}`,
      ...(this.options.args ?? []),
    ], { stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;
    this.exited = new Promise((resolve) => child.once("close", () => resolve()));
    let up = false;
    const kill_on_exit = () => child.kill("SIGKILL");
    process.once("exit", kill_on_exit);
    let stopped: string | null = null;

    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim() === "") continue;
        this.last_log = line.trim();
        this.options.on_log?.(this.last_log);
      }
    });
    child.on("error", (error) => {
      stopped = error.message;
    });
    child.on("close", (code, signal) => {
      process.off("exit", kill_on_exit);
      stopped ??= signal ? `signal ${signal}` : `exit code ${code}`;
      if (this.child === child) this.child = null;
      if (!up) return;
      this.lose_mpv();
      if (!this.closed) this.tell_stopped(`mpv stopped (${stopped})${this.log_detail()}`, code === 0);
    });

    await this.connect(() => stopped);
    for (const [id, { property }] of this.observers) await this.send(["observe_property", id, property]);
    this.observing = true;
    up = true;
  }

  // An mpv that has gone leaves the next command to start another.
  private lose_mpv(): void {
    if (!this.observing) return;
    this.ready = null;
    this.observing = false;
    this.socket?.destroy();
    this.socket = null;
  }

  // An mpv still exiting is given a moment to finish, so its reason is told before the next one starts.
  private async wait_for_previous(): Promise<void> {
    const previous = this.child;
    if (!previous) return;
    const exited = this.exited;
    if (await Promise.race([exited.then(() => true), sleep(quit_grace_in_milliseconds).then(() => false)])) return;
    previous.kill("SIGKILL");
    await exited;
  }

  // mpv makes its socket a moment after it starts, so connecting is tried again until mpv stops or time runs out.
  private connect(stopped: () => string | null): Promise<void> {
    const timeout = this.options.start_timeout_in_milliseconds ?? start_timeout_in_milliseconds;
    const deadline = Date.now() + timeout;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const reason = stopped();
        if (reason !== null) {
          reject(new Error(`mpv stopped while starting (${reason})${this.log_detail()}`));
          return;
        }
        if (this.closed) {
          reject(new Error("mpv was closed"));
          return;
        }
        const socket = createConnection(this.socket_path);
        socket.once("connect", () => {
          this.socket = socket;
          this.buffer = "";
          socket.setEncoding("utf8");
          socket.on("data", (chunk: string) => this.on_data(chunk));
          socket.on("error", () => socket.destroy());
          socket.on("close", () => {
            if (this.socket === socket) {
              this.lose_mpv();
              this.socket = null;
            }
            this.fail_waiters(new Error("mpv stopped answering"));
          });
          resolve();
        });
        socket.once("error", () => {
          socket.destroy();
          if (Date.now() < deadline) {
            setTimeout(attempt, connect_retry_in_milliseconds);
            return;
          }
          reject(new Error(`mpv did not answer within ${Number((timeout / 1000).toFixed(1))} seconds${this.log_detail()}`));
        });
      };
      attempt();
    });
  }

  private log_detail(): string {
    return this.last_log ? `: ${this.last_log}` : "";
  }

  private tell_stopped(reason: string, clean: boolean): void {
    for (const listener of this.stop_listeners) listener(reason, clean);
  }

  // Stops the program and closes the socket, after a failed start or on closing.
  private halt(): void {
    this.observing = false;
    this.socket?.destroy();
    this.socket = null;
    this.child?.kill("SIGKILL");
    this.child = null;
    rmSync(this.socket_path, { force: true });
  }

  // ── Talking ────────────────────────────────────────────────────────────────

  // Writes a command straight to the socket, which the start itself uses, since waiting for the start there would never end.
  private send(args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("mpv is not running"));
        return;
      }
      const request_id = this.next_request_id++;
      this.waiters.set(request_id, { resolve, reject });
      this.socket.write(`${JSON.stringify({ command: args, request_id })}\n`);
    });
  }

  private fail_waiters(error: Error): void {
    for (const waiter of this.waiters.values()) waiter.reject(error);
    this.waiters.clear();
  }

  private on_data(chunk: string): void {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line === "") continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // A garbled line is dropped so the ones after it still arrive.
        continue;
      }
      if (typeof message.request_id === "number" && message.event === undefined) {
        this.answer(message.request_id, message);
        continue;
      }
      if (typeof message.event === "string") this.hear(message as MpvEvent);
    }
  }

  private answer(request_id: number, message: Record<string, unknown>): void {
    const waiter = this.waiters.get(request_id);
    if (!waiter) return;
    this.waiters.delete(request_id);
    if (message.error === "success") waiter.resolve(message.data);
    else waiter.reject(new Error(`mpv refused the command: ${String(message.error)}`));
  }

  private hear(event: MpvEvent): void {
    if (event.event === "property-change" && typeof event.id === "number") {
      this.observers.get(event.id)?.listener(event.data);
    }
    for (const listener of this.event_listeners) listener(event);
  }
}

// ── The playback engine ──────────────────────────────────────────────────────

export type EngineState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface LoadOptions {
  // Plays only part of the file, such as one track of a CUE sheet or a chapter.
  start_in_milliseconds?: number | null;
  end_in_milliseconds?: number | null;
  // A loudness change, such as a ReplayGain, applied as a volume filter.
  gain_in_decibels?: number | null;
  // More of mpv's options for this file alone, such as `{ "sub-file": path }`.
  mpv_options?: Record<string, string>;
}

export interface EngineEvents {
  // At most once per position interval while playing.
  position: { position_in_milliseconds: number; duration_in_milliseconds: number | null };
  state: { state: EngineState; error?: string };
  // The file played to its end, rather than being replaced or stopped.
  ended: Record<string, never>;
}

export type EngineListener = <Name extends keyof EngineEvents>(event: Name, payload: EngineEvents[Name]) => void;

// What an app's player drives: one file at a time, with the next one named ahead for a gapless join.
export interface PlaybackEngine {
  load(uri: string, options?: LoadOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(position_in_milliseconds: number): Promise<void>;
  // From 0 to 100.
  set_volume(volume: number): Promise<void>;
  preload?(uri: string, options?: LoadOptions): Promise<void>;
  subscribe(listener: EngineListener): () => void;
  dispose(): Promise<void>;
}

export interface MpvEngineOptions extends MpvProcessOptions {
  // Shows video in mpv's own window; sound only unless set.
  video?: boolean;
  // How often the position is reported at most, in milliseconds; 250 unless set, 0 for every change.
  position_interval_in_milliseconds?: number;
}

// mpv's per-file options, in the form loadfile takes them.
function file_options(options: LoadOptions | undefined): string[] {
  const flags: string[] = [];
  if (options?.start_in_milliseconds != null) flags.push(`start=${(options.start_in_milliseconds / 1000).toFixed(3)}`);
  if (options?.end_in_milliseconds != null) flags.push(`end=${(options.end_in_milliseconds / 1000).toFixed(3)}`);
  if (options?.gain_in_decibels != null) flags.push(`af-add=volume=${Math.pow(10, options.gain_in_decibels / 20).toFixed(4)}`);
  for (const [name, value] of Object.entries(options?.mpv_options ?? {})) flags.push(`${name}=${value}`);
  return flags;
}

// The loadfile command; mpv 0.38 put an index before the options, which it refuses empty, so they are left out when none.
export function loadfile_command(uri: string, mode: "replace" | "append", options?: LoadOptions): unknown[] {
  const flags = file_options(options);
  return flags.length > 0 ? ["loadfile", uri, mode, -1, flags.join(",")] : ["loadfile", uri, mode];
}

export class MpvEngine implements PlaybackEngine {
  // The mpv underneath, for an app that needs more of it, such as its audio tracks or subtitles.
  readonly mpv: MpvProcess;
  private readonly listeners = new Set<EngineListener>();
  private readonly position_interval: number;
  private state: EngineState = "idle";
  private duration: number | null = null;
  private last_position_at = 0;
  // Set while a file is being swapped in, so mpv going idle meanwhile is not taken as the end.
  private swapping = false;

  constructor(options: MpvEngineOptions = {}) {
    const { video = false, position_interval_in_milliseconds = 250, ...process_options } = options;
    this.position_interval = position_interval_in_milliseconds;
    this.mpv = new MpvProcess({
      ...process_options,
      args: [
        ...(video ? [] : ["--no-video", "--audio-display=no"]),
        "--gapless-audio=yes",
        "--keep-open=no",
        ...(process_options.args ?? []),
      ],
    });
    this.mpv.observe("time-pos", (value) => this.on_position(value));
    this.mpv.observe("duration", (value) => {
      this.duration = typeof value === "number" ? Math.round(value * 1000) : null;
    });
    this.mpv.observe("pause", (value) => {
      if (typeof value === "boolean" && (this.state === "playing" || this.state === "paused")) this.set_state(value ? "paused" : "playing");
    });
    this.mpv.observe("idle-active", (value) => {
      // mpv goes idle when its playlist runs out, which is how a file that played to its end shows.
      if (value !== true || this.swapping || (this.state !== "playing" && this.state !== "paused")) return;
      this.set_state("ended");
      this.emit("ended", {});
    });
    this.mpv.on_event((event) => {
      if (event.event === "end-file" && event.reason === "error") this.set_state("error", String(event.file_error ?? "playback failed"));
    });
    this.mpv.on_stop((reason, clean) => (clean ? this.set_state("idle") : this.set_state("error", reason)));
  }

  private emit: EngineListener = (event, payload) => {
    for (const listener of this.listeners) listener(event, payload);
  };

  private set_state(state: EngineState, error?: string): void {
    if (this.state === state && !error) return;
    this.state = state;
    this.emit("state", error ? { state, error } : { state });
  }

  private on_position(value: unknown): void {
    if (typeof value !== "number") return;
    const now = Date.now();
    if (now - this.last_position_at < this.position_interval) return;
    this.last_position_at = now;
    this.emit("position", { position_in_milliseconds: Math.round(value * 1000), duration_in_milliseconds: this.duration });
  }

  async load(uri: string, options?: LoadOptions): Promise<void> {
    this.swapping = true;
    this.set_state("loading");
    this.duration = null;
    this.last_position_at = 0;
    try {
      await this.mpv.command(...loadfile_command(uri, "replace", options));
      await this.mpv.set_property("pause", false);
      this.set_state("playing");
    } finally {
      this.swapping = false;
    }
  }

  // Puts the next file in mpv's own playlist, which is what makes the join gapless.
  async preload(uri: string, options?: LoadOptions): Promise<void> {
    await this.mpv.command(...loadfile_command(uri, "append", options));
  }

  async play(): Promise<void> {
    await this.mpv.set_property("pause", false);
    this.set_state("playing");
  }

  async pause(): Promise<void> {
    await this.mpv.set_property("pause", true);
    this.set_state("paused");
  }

  async stop(): Promise<void> {
    if (!this.mpv.running) {
      this.set_state("idle");
      return;
    }
    this.swapping = true;
    try {
      await this.mpv.command("stop");
      this.set_state("idle");
    } finally {
      this.swapping = false;
    }
  }

  async seek(position_in_milliseconds: number): Promise<void> {
    await this.mpv.command("seek", position_in_milliseconds / 1000, "absolute");
    this.last_position_at = 0;
  }

  async set_volume(volume: number): Promise<void> {
    await this.mpv.set_property("volume", volume);
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    await this.mpv.close();
  }
}

// ── An engine for tests ──────────────────────────────────────────────────────

// Plays nothing and remembers what it was asked, for testing an app's player without mpv.
export class NullEngine implements PlaybackEngine {
  private readonly listeners = new Set<EngineListener>();
  state: EngineState = "idle";
  uri: string | null = null;
  position_in_milliseconds = 0;
  volume = 100;
  readonly loaded: string[] = [];
  readonly preloaded: string[] = [];

  private emit: EngineListener = (event, payload) => {
    for (const listener of this.listeners) listener(event, payload);
  };

  private set_state(state: EngineState): void {
    this.state = state;
    this.emit("state", { state });
  }

  async load(uri: string): Promise<void> {
    this.uri = uri;
    this.loaded.push(uri);
    this.position_in_milliseconds = 0;
    this.set_state("loading");
  }

  async play(): Promise<void> {
    this.set_state("playing");
  }

  async pause(): Promise<void> {
    this.set_state("paused");
  }

  async stop(): Promise<void> {
    this.uri = null;
    this.set_state("idle");
  }

  async seek(position_in_milliseconds: number): Promise<void> {
    this.position_in_milliseconds = position_in_milliseconds;
    this.emit("position", { position_in_milliseconds, duration_in_milliseconds: null });
  }

  async set_volume(volume: number): Promise<void> {
    this.volume = volume;
  }

  async preload(uri: string): Promise<void> {
    this.preloaded.push(uri);
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
  }

  // Reports a position, as mpv does while playing.
  tick(position_in_milliseconds: number, duration_in_milliseconds: number | null = 200_000): void {
    this.position_in_milliseconds = position_in_milliseconds;
    this.emit("position", { position_in_milliseconds, duration_in_milliseconds });
  }

  // Plays the file to its end.
  finish(): void {
    this.state = "ended";
    this.emit("ended", {});
  }

  fail(message: string): void {
    this.state = "error";
    this.emit("state", { state: "error", error: message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds).unref());
}
