// Messages one local process hands to others through a unix socket, one JSON object per line: the server end sends
// every message to everyone connected, and a follower reconnects whenever the socket is not there, such as a desktop
// session's agent following a system agent's notifications while their server is out of reach.

// ── Imports ──────────────────────────────────────────────────────────────────

import { chmodSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";

// ── Settings ─────────────────────────────────────────────────────────────────

// How long a follower waits before trying the socket again.
export const RETRY_SECONDS = 5.0;

// ── Server ───────────────────────────────────────────────────────────────────

// Sends each message as a JSON line to every process connected to a unix socket.
export class LineServer {
  readonly path: string;
  readonly sockets = new Set<Socket>();
  private readonly mode: number;
  private server: Server | null = null;

  // `mode` is the socket file's permissions; 0o666 unless set, so processes of other users may follow it.
  constructor(path: string, mode = 0o666) {
    this.path = path;
    this.mode = mode;
  }

  // Listens on the socket, replacing one a previous run left behind.
  async start(): Promise<void> {
    try {
      unlinkSync(this.path);
    } catch {
      // Nothing was left behind.
    }
    const server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on("error", () => undefined);
      socket.on("close", () => this.sockets.delete(socket));
      socket.resume();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.path, () => resolve());
    });
    this.server = server;
    chmodSync(this.path, this.mode);
  }

  // Hands one message to every connected process; one that has gone away is dropped.
  async send(message: unknown): Promise<void> {
    const line = `${JSON.stringify(message)}\n`;
    for (const socket of this.sockets) {
      try {
        await new Promise<void>((resolve, reject) => socket.write(line, (error) => (error ? reject(error) : resolve())));
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  close(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = null;
  }
}

// ── Follower ─────────────────────────────────────────────────────────────────

export interface FollowOptions {
  // Which messages are handed on; every JSON object unless set.
  accept?: (message: Record<string, unknown>) => boolean;
  retry_seconds?: number;
  // Told why the connection ended, before the next try.
  on_disconnect?: (reason: string) => void;
}

// Hands every message served on `path` to `handle`, reconnecting whenever the socket is not there, until the signal aborts.
export async function follow_lines(path: string, handle: (message: Record<string, unknown>) => unknown, signal: AbortSignal, options: FollowOptions = {}): Promise<void> {
  const retry = options.retry_seconds ?? RETRY_SECONDS;
  const pause = () => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, retry * 1000);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  while (!signal.aborted) {
    const socket = createConnection(path);
    const ended = new Promise<void>((resolve) => {
      socket.on("error", (error) => {
        options.on_disconnect?.(error.message);
        resolve();
      });
      socket.on("close", () => resolve());
    });
    const stop = () => socket.destroy();
    signal.addEventListener("abort", stop, { once: true });
    const lines = createInterface({ input: socket });
    // The reader passes the socket's errors on, and the socket's own listener already handles them.
    lines.on("error", () => undefined);
    lines.on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof message !== "object" || message === null || Array.isArray(message)) return;
      if (options.accept && !options.accept(message as Record<string, unknown>)) return;
      void handle(message as Record<string, unknown>);
    });
    await ended;
    signal.removeEventListener("abort", stop);
    await pause();
  }
}
