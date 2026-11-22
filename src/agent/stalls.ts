// What a stalled long run is doing, read from /proc: the programs it still runs, the file locks they wait for, and the
// processes holding those locks; and a watch that writes this into the run's output once it has been quiet a while,
// again each half hour it stays quiet. Everything here is readable by any user, so it works for root's programs too.

// ── Imports ──────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { format_duration } from "../durations.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

export const first_note_in_seconds = 300;
export const later_notes_in_seconds = 1800;
const look_interval_in_milliseconds = 30_000;

// Clock ticks per second in /proc's start times, which Linux fixes at 100 for user space.
const ticks_per_second = 100;

// How many holders a note names before counting the rest.
const holders_named = 6;

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  age_in_seconds: number;
}

export interface LockEntry {
  pid: number;
  // Whether the process waits for the lock, rather than holding it.
  waiting: boolean;
  mode: "READ" | "WRITE";
  // The locked file as /proc/locks names it: device and inode.
  file: string;
}

// A lock file a note names by what a person calls it, with a line of advice shown when a run waits for it.
export interface KnownLock {
  name: string;
  hint?: string;
}

export interface StallOptions {
  proc?: string;
  // The lock files to name, by path.
  known_locks?: Record<string, KnownLock>;
  // The known locks' /proc/locks ids by path; read from the real paths when absent.
  lock_files?: Record<string, string>;
  // Put before every line, so a reader can pick the notes out of the run's output.
  mark?: string;
}

// ── Reading /proc ────────────────────────────────────────────────────────────

export function read_processes(proc = "/proc"): Map<number, ProcessInfo> {
  const uptime = Number(read_text(join(proc, "uptime")).split(" ")[0]) || 0;
  const processes = new Map<number, ProcessInfo>();
  for (const entry of list(proc)) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = read_text(join(proc, entry, "stat"));
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    if (open === -1 || close === -1) continue;
    // The fields after the name start at the state, the third field; the start time is the 22nd.
    const fields = stat.slice(close + 2).split(" ");
    const started = Number(fields[19]) / ticks_per_second;
    processes.set(Number(entry), { pid: Number(entry), ppid: Number(fields[1]), name: stat.slice(open + 1, close), age_in_seconds: Math.max(0, uptime - started) });
  }
  return processes;
}

export function read_locks(proc = "/proc"): LockEntry[] {
  const entries: LockEntry[] = [];
  for (const line of read_text(join(proc, "locks")).split("\n")) {
    const words = line.trim().split(/\s+/);
    const waiting = words[1] === "->";
    // A line is its number, the lock's kind and class, its mode, then the process and the file; a waiter's has "->" first.
    const [, , , mode, pid, file] = waiting ? words.slice(1) : words;
    if (pid === undefined || file === undefined || (mode !== "READ" && mode !== "WRITE")) continue;
    entries.push({ pid: Number(pid), waiting, mode, file });
  }
  return entries;
}

// How /proc/locks names a file: its device's major and minor numbers in hex, then its inode.
export function lock_file_id(path: string): string | null {
  try {
    const { dev, ino } = statSync(path, { bigint: true });
    const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn);
    const minor = (dev & 0xffn) | ((dev >> 12n) & ~0xffn);
    return `${major.toString(16).padStart(2, "0")}:${minor.toString(16).padStart(2, "0")}:${ino}`;
  } catch {
    return null;
  }
}

// The /proc/locks ids of the files that exist, by path.
export function lock_file_ids(paths: readonly string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of paths) {
    const id = lock_file_id(path);
    if (id !== null) files[path] = id;
  }
  return files;
}

// ── Questions ────────────────────────────────────────────────────────────────

// Every process started under the root, at any depth.
export function descendants(processes: Map<number, ProcessInfo>, root: number): ProcessInfo[] {
  const children = new Map<number, ProcessInfo[]>();
  for (const info of processes.values()) children.set(info.ppid, [...(children.get(info.ppid) ?? []), info]);
  const found: ProcessInfo[] = [];
  const next = [...(children.get(root) ?? [])];
  while (next.length > 0) {
    const info = next.shift()!;
    found.push(info);
    next.push(...(children.get(info.pid) ?? []));
  }
  return found;
}

// The processes holding a lock on the file, other than those given.
export function lock_holders(path: string, except: Set<number> = new Set(), proc = "/proc", file_id = lock_file_id(path)): ProcessInfo[] {
  if (file_id === null) return [];
  const processes = read_processes(proc);
  const pids = new Set(read_locks(proc).filter((entry) => !entry.waiting && entry.file === file_id && !except.has(entry.pid)).map((entry) => entry.pid));
  return [...pids].map((pid) => processes.get(pid)).filter((info): info is ProcessInfo => info !== undefined);
}

// Names a process the way a note shows it.
export function show_process(info: ProcessInfo): string {
  return `${info.name} (pid ${info.pid}, running for ${format_duration(info.age_in_seconds, { largest_unit: "days" })})`;
}

export function show_holders(holders: ProcessInfo[]): string {
  const named = holders.slice(0, holders_named).map(show_process).join(", ");
  return holders.length > holders_named ? `${named} and ${holders.length - holders_named} more` : named;
}

// ── Notes ────────────────────────────────────────────────────────────────────

// The lines a run prints once it has been quiet for the given time: what it still runs, and what any of it waits for.
export function describe_stall(root: number, quiet_in_seconds: number, options: StallOptions = {}): string[] {
  const proc = options.proc ?? "/proc";
  const known = options.known_locks ?? {};
  const files = options.lock_files ?? lock_file_ids(Object.keys(known));
  const processes = read_processes(proc);
  const under = descendants(processes, root);
  const own = new Set(under.map((info) => info.pid));

  const parents = new Set(under.map((info) => info.ppid));
  const chains = under.filter((info) => !parents.has(info.pid)).slice(0, 3).map((leaf) => chain_to(processes, root, leaf));
  const lines = [`No output for ${format_duration(quiet_in_seconds)}; still running ${chains.length > 0 ? chains.join("; ") : "nothing under the run"}`];

  const locks = read_locks(proc);
  for (const wait of locks.filter((entry) => entry.waiting && own.has(entry.pid))) {
    const waiter = processes.get(wait.pid)!;
    const path = Object.entries(files).find(([, id]) => id === wait.file)?.[0] ?? null;
    const lock = path === null ? undefined : known[path];
    const holders = [...new Set(locks.filter((entry) => !entry.waiting && entry.file === wait.file && entry.pid !== wait.pid).map((entry) => entry.pid))]
      .map((pid) => processes.get(pid))
      .filter((info): info is ProcessInfo => info !== undefined);
    const what = lock === undefined ? `a lock on file ${wait.file}` : `${lock.name} (${path})`;
    lines.push(`${waiter.name} (pid ${waiter.pid}) waits for ${what}, held by ${holders.length > 0 ? show_holders(holders) : "nothing it can see"}`);
    if (lock?.hint !== undefined) lines.push(lock.hint);
  }
  return options.mark === undefined ? lines : lines.map((line) => `${options.mark} ${line}`);
}

// The programs from the root down to the leaf, as "a › b › c (pid N)".
function chain_to(processes: Map<number, ProcessInfo>, root: number, leaf: ProcessInfo): string {
  const names: string[] = [];
  for (let info: ProcessInfo | undefined = leaf; info !== undefined && info.pid !== root; info = processes.get(info.ppid)) names.unshift(info.name);
  return `${names.join(" › ")} (pid ${leaf.pid})`;
}

// ── Watching ─────────────────────────────────────────────────────────────────

export interface StallWatch {
  // Called on every piece of output the run prints.
  heard(): void;
  // Looks now rather than on the next tick; the timer calls it too.
  look(): void;
  stop(): void;
}

export interface StallWatchOptions extends StallOptions {
  now?: () => number;
  first_note_in_seconds?: number;
  later_notes_in_seconds?: number;
}

// Watches the run started by the root process, writing a note once it has printed nothing for a while.
export function watch_for_stalls(root: number, write: (text: string) => void, options: StallWatchOptions = {}): StallWatch {
  const now = options.now ?? Date.now;
  const first_note = (options.first_note_in_seconds ?? first_note_in_seconds) * 1000;
  const later_notes = (options.later_notes_in_seconds ?? later_notes_in_seconds) * 1000;
  let last_heard = now();
  let next_note = last_heard + first_note;

  const look = () => {
    if (now() < next_note) return;
    const lines = describe_stall(root, (now() - last_heard) / 1000, options);
    write(`${lines.join("\n")}\n`);
    next_note = now() + later_notes;
  };
  const timer = setInterval(look, look_interval_in_milliseconds);
  timer.unref();

  return {
    heard: () => {
      last_heard = now();
      next_note = last_heard + first_note;
    },
    look,
    stop: () => clearInterval(timer),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function read_text(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function list(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
