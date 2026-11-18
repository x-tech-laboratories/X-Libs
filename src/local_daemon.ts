// A desktop app's daemon and the windows that talk to it, as the Application Standard sets out: the daemon serves the
// app's calls over HTTP on a Unix socket only its user can open, one daemon per user and data file, and a window starts
// it when none is answering. The window forwards its page's calls with `call_daemon` and hears the daemon's change
// events with `follow_daemon_events`, which reconnects when the daemon restarts. Nothing here imports Electron: in an
// Electron process `start_daemon` runs Electron's own binary as Node, so the app ships no second runtime.

// ── Imports ──────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";

// ── Paths ────────────────────────────────────────────────────────────────────

export interface SocketPathOptions {
  // The app's name in lower case, such as "x-tasks".
  app: string;
  // Set for a run on a data file other than the user's own, such as a test database, which then gets a socket of its
  // own; null or unset for the user's own data.
  data_file?: string | null;
  // The runtime folder; $XDG_RUNTIME_DIR unless set, and a per-user folder in the temporary folder without one.
  runtime_dir?: string;
}

// `<runtime>/<app>/daemon.sock` for the user's own data, `<runtime>/<app>/daemon-<hash>.sock` for any other file, so a
// test run never reaches the user's daemon. The hash keeps the path short, since a socket's path is limited to 107 bytes.
export function daemon_socket_path({ app, data_file = null, runtime_dir }: SocketPathOptions): string {
  const runtime = runtime_dir ?? process.env.XDG_RUNTIME_DIR ?? join(tmpdir(), `${app}-${userInfo().uid}`);
  const name = data_file ? `daemon-${createHash("sha256").update(data_file).digest("hex").slice(0, 12)}.sock` : "daemon.sock";
  return join(runtime, app, name);
}

// `~/.local/state/<app>/daemon.log`, or under $XDG_STATE_HOME when it is set.
export function daemon_log_path(app: string, state_dir = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")): string {
  return join(state_dir, app, "daemon.log");
}

// ── Daemon side ──────────────────────────────────────────────────────────────

export class DaemonRunningError extends Error {
  constructor(socket_path: string) {
    super(`a daemon is already answering on ${socket_path}`);
    this.name = "DaemonRunningError";
  }
}

// Whether something accepts connections on the socket within the time given.
export function is_answering(socket_path: string, timeout_ms = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(socket_path)) return resolve(false);
    const socket = connect(socket_path);
    const timer = setTimeout(() => finish(false), timeout_ms);
    function finish(answered: boolean): void {
      clearTimeout(timer);
      socket.destroy();
      resolve(answered);
    }
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

// Listens on the socket through the server's own listen, such as Fastify's `(path) => app.listen({ path })`: its folder
// is made for this user alone, a socket left by a daemon that died is removed, and one still answering refuses with
// DaemonRunningError, so a second daemon exits. The socket itself is then made readable by its user alone.
export async function listen_on_socket(socket_path: string, listen: (path: string) => Promise<unknown>): Promise<void> {
  const folder = dirname(socket_path);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  if (await is_answering(socket_path)) throw new DaemonRunningError(socket_path);
  rmSync(socket_path, { force: true });
  await listen(socket_path);
  chmodSync(socket_path, 0o600);
}

// ── Window side ──────────────────────────────────────────────────────────────

export interface StartDaemonOptions {
  socket_path: string;
  // The daemon's built entry file.
  script: string;
  args?: string[];
  // Added to this process's environment.
  env?: Record<string, string>;
  // Where the daemon's output goes; daemon_log_path's file is usual.
  log_file: string;
  // How long to wait for the socket to answer; 15 seconds unless set.
  timeout_ms?: number;
}

const POLL_MS = 100;

// Starts the daemon unless one is answering already, and waits until it answers. It is started apart from this
// process, so closing the window leaves it running. Resolves to whether it had to be started.
export async function start_daemon(options: StartDaemonOptions): Promise<"running" | "started"> {
  const { socket_path, script, args = [], env = {}, log_file, timeout_ms = 15_000 } = options;
  if (await is_answering(socket_path)) return "running";

  mkdirSync(dirname(log_file), { recursive: true });
  const log = openSync(log_file, "a");
  const child_env: NodeJS.ProcessEnv = { ...process.env, ...env };
  // Electron's binary runs the script as plain Node with this set.
  if (process.versions.electron) child_env.ELECTRON_RUN_AS_NODE = "1";
  else delete child_env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, [script, ...args], { env: child_env, detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  let exit_code: number | null = null;
  child.once("exit", (code) => (exit_code = code ?? -1));
  child.unref();

  const deadline = Date.now() + timeout_ms;
  while (Date.now() < deadline) {
    if (await is_answering(socket_path)) return "started";
    // A second daemon started at the same moment exits once the first answers, so its exit is only a failure if none answers.
    if (exit_code !== null && !(await is_answering(socket_path))) throw new Error(`the daemon exited with ${exit_code}: ${last_line(log_file)}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`the daemon did not answer on ${socket_path} within ${timeout_ms / 1000} seconds: ${last_line(log_file)}`);
}

function last_line(file: string): string {
  const lines = readFileSync(file, "utf8").trim().split("\n");
  return lines[lines.length - 1] || "no output";
}

export interface SocketReply {
  status: number;
  text: string;
}

// One HTTP request over the socket.
export function socket_request(socket_path: string, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<SocketReply> {
  return new Promise((resolve, reject) => {
    const sent_headers = body === undefined ? headers : { "content-type": "application/json", ...headers };
    const outgoing = request({ socketPath: socket_path, method, path, headers: sent_headers }, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => (text += chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, text }));
      incoming.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

// Posts one call with its arguments as a JSON array, the way a server's bridge route takes them, and answers with what
// it returned: undefined for 204, the parsed JSON otherwise. A refusal throws with the daemon's own message.
export async function call_daemon(socket_path: string, path: string, args: unknown[] = [], headers: Record<string, string> = {}): Promise<unknown> {
  const reply = await socket_request(socket_path, "POST", path, JSON.stringify(args), headers);
  if (reply.status >= 400) throw new Error(daemon_error(reply));
  if (reply.status === 204 || reply.text === "") return undefined;
  return JSON.parse(reply.text);
}

// The message of a Fastify error reply, or the text as it came.
function daemon_error(reply: SocketReply): string {
  try {
    const parsed = JSON.parse(reply.text) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Plain text.
  }
  return reply.text || `the daemon answered ${reply.status}`;
}

export interface FollowOptions {
  // Runs on every connection, the first and each one after the daemon came back, when changes may have been missed.
  on_connect?: () => void;
  on_disconnect?: () => void;
  // How long to wait before trying again; one second unless set.
  retry_ms?: number;
}

// Follows the daemon's server-sent events, such as the change events of `server/events`, handing each its name and
// data; reconnects whenever the stream ends or the daemon is not there. Returns how to stop.
export function follow_daemon_events(socket_path: string, path: string, on_event: (event: string, data: string) => void, options: FollowOptions = {}): () => void {
  const retry_ms = options.retry_ms ?? 1000;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let current: ReturnType<typeof request> | null = null;

  function again(was_connected: boolean): void {
    current = null;
    if (was_connected) options.on_disconnect?.();
    if (!stopped) retry = setTimeout(open, retry_ms);
  }

  function open(): void {
    let connected = false;
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      again(connected);
    };
    current = request({ socketPath: socket_path, method: "GET", path, headers: { accept: "text/event-stream" } }, (incoming) => {
      if ((incoming.statusCode ?? 0) >= 400) {
        incoming.resume();
        incoming.on("end", end);
        return;
      }
      connected = true;
      options.on_connect?.();
      let buffer = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => {
        buffer += chunk.replace(/\r\n/g, "\n");
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const parsed = parse_event(block);
          if (parsed) on_event(parsed.event, parsed.data);
        }
      });
      incoming.on("end", end);
      incoming.on("error", end);
      incoming.on("close", end);
    });
    current.on("error", end);
    current.end();
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    current?.destroy();
  };
}

// One event block: its name, "message" when it has none, and its data lines joined; null for a comment alone.
export function parse_event(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  let has_field = false;
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else continue;
    has_field = true;
  }
  return has_field ? { event, data: data.join("\n") } : null;
}
