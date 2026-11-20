import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CurrentDaemon } from "../src/connections.ts";
import { create_daemon_link, follow_remote_events } from "../src/daemon_link.ts";

// ============================================================================
// Helpers
// ============================================================================

let folder: string;
const servers: Server[] = [];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "daemon-link-"));
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(folder, { recursive: true, force: true });
});

interface Seen {
  path: string;
  authorization: string;
  body: string;
}

// A daemon that answers each call with who it is and what it was sent, refuses "/api/broken", and streams one event.
function daemon(name: string, seen: Seen[] = []): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({ path: request.url ?? "", authorization: request.headers.authorization ?? "", body });
      if (request.url === "/api/events") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`event: hello\r\ndata: ${name}\r\n\r\n`);
        return;
      }
      if (request.url === "/api/broken") {
        response.writeHead(400, { "content-type": "application/json" });
        return void response.end(JSON.stringify({ message: "That task does not exist." }));
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ daemon: name, args: JSON.parse(body || "[]") }));
    });
  };
}

async function on_socket(name: string): Promise<string> {
  const path = join(folder, "daemon.sock");
  const server = createServer(daemon(name));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return path;
}

async function on_port(name: string, seen?: Seen[]): Promise<string> {
  const server = createServer(daemon(name, seen));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// The part of `connections` the link reads, switched by hand.
function chosen(start: CurrentDaemon) {
  let current = start;
  const listeners = new Set<(daemon: CurrentDaemon) => void>();
  return {
    current: () => current,
    subscribe: (listener: (daemon: CurrentDaemon) => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    choose(next: CurrentDaemon): void {
      current = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function wait_for(check: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error("timed out"));
      }
    }, 10);
  });
}

// ============================================================================
// Calls
// ============================================================================

describe("create_daemon_link calls", () => {
  it("sends a call to the local daemon over its socket, then to a remote one with the token once it is chosen", async () => {
    const seen: Seen[] = [];
    const socket_path = await on_socket("local");
    const address = await on_port("remote", seen);
    const connections = chosen({ kind: "local" });
    const link = create_daemon_link({ connections, socket_path });

    expect(await link.call("/api/tasks/list_tasks", ["today"])).toEqual({ daemon: "local", args: ["today"] });

    connections.choose({ kind: "remote", id: "remote-1", address, token: "token-1" });
    expect(await link.call("/api/tasks/list_tasks", ["today"], { "x-client-id": "7" })).toEqual({ daemon: "remote", args: ["today"] });
    expect(seen[0]).toEqual({ path: "/api/tasks/list_tasks", authorization: "Bearer token-1", body: "[\"today\"]" });
  });

  it("throws a remote daemon's refusal in its own words, and says when none is chosen or one does not answer", async () => {
    const address = await on_port("remote");
    const link = create_daemon_link({ connections: chosen({ kind: "remote", id: "remote-1", address, token: "token-1" }), socket_path: join(folder, "none.sock") });
    await expect(link.call("/api/broken")).rejects.toThrow("That task does not exist.");

    await expect(create_daemon_link({ connections: chosen(null), socket_path: "" }).call("/api/x")).rejects.toThrow("No daemon is chosen yet.");

    const gone = create_daemon_link({ connections: chosen({ kind: "remote", id: "remote-1", address: "http://127.0.0.1:1", token: "t" }), socket_path: "" });
    await expect(gone.call("/api/x")).rejects.toThrow("The daemon at http://127.0.0.1:1 did not answer");
  });
});

// ============================================================================
// Events
// ============================================================================

describe("create_daemon_link events", () => {
  it("follows the local daemon's events, then moves to the remote daemon chosen next", async () => {
    const socket_path = await on_socket("local");
    const address = await on_port("remote");
    const connections = chosen({ kind: "local" });
    const heard: string[] = [];
    const stop = create_daemon_link({ connections, socket_path }).follow_events("/api/events", (event, data) => heard.push(`${event}:${data}`));

    await wait_for(() => heard.includes("hello:local"));
    connections.choose({ kind: "remote", id: "remote-1", address, token: "token-1" });
    await wait_for(() => heard.includes("hello:remote"));
    stop();
  });
});

describe("follow_remote_events", () => {
  it("hands on each event, sends the headers, and reconnects after the stream ends, saying so each time", async () => {
    const seen: Seen[] = [];
    const address = await on_port("remote", seen);
    const heard: string[] = [];
    let connects = 0;
    let disconnects = 0;
    const stop = follow_remote_events(`${address}/api/events`, { authorization: "Bearer token-1" }, (event, data) => heard.push(`${event}:${data}`), {
      retry_ms: 20,
      on_connect: () => connects++,
      on_disconnect: () => disconnects++,
    });

    await wait_for(() => heard.length === 1);
    servers[0]!.closeAllConnections();
    await wait_for(() => heard.length === 2 && connects === 2);
    stop();

    expect(heard).toEqual(["hello:remote", "hello:remote"]);
    expect(disconnects).toBe(1);
    expect(seen[0]?.authorization).toBe("Bearer token-1");
  });
});
