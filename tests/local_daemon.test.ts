import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  call_daemon, covered_descriptors, daemon_build_id, daemon_build_path, daemon_log_path, daemon_socket_path, DaemonRunningError, follow_daemon_events, is_answering, listen_on_socket, parse_event,
  read_daemon_build, start_daemon,
} from "../src/local_daemon.ts";

let folder: string;
const servers: Server[] = [];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "local-daemon-"));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  rmSync(folder, { recursive: true, force: true });
});

function serve(handler: Parameters<typeof createServer>[1]): { server: Server; listen: (path: string) => Promise<void> } {
  const server = createServer(handler);
  servers.push(server);
  return { server, listen: (path) => new Promise((resolve) => server.listen(path, resolve)) };
}

function wait_for(check: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 5000) {
        clearInterval(timer);
        reject(new Error("timed out"));
      }
    }, 10);
  });
}

describe("daemon_socket_path", () => {
  it("names the user's own socket daemon.sock and gives any other data file one of its own", () => {
    expect(daemon_socket_path({ app: "x-tasks", runtime_dir: "/run/user/1000" })).toBe("/run/user/1000/x-tasks/daemon.sock");
    const test_socket = daemon_socket_path({ app: "x-tasks", data_file: "/tmp/test.db", runtime_dir: "/run/user/1000" });
    expect(test_socket).toMatch(/^\/run\/user\/1000\/x-tasks\/daemon-[0-9a-f]{12}\.sock$/);
    expect(daemon_socket_path({ app: "x-tasks", data_file: "/tmp/other.db", runtime_dir: "/run/user/1000" })).not.toBe(test_socket);
  });

  it("keeps the log under the state folder", () => {
    expect(daemon_log_path("x-tasks", "/home/someone/.local/state")).toBe("/home/someone/.local/state/x-tasks/daemon.log");
  });
});

describe("listen_on_socket", () => {
  it("makes the folder and socket for this user alone", async () => {
    const socket = join(folder, "app", "daemon.sock");
    await listen_on_socket(socket, serve((_, response) => response.end()).listen);
    expect(statSync(join(folder, "app")).mode & 0o777).toBe(0o700);
    expect(statSync(socket).mode & 0o777).toBe(0o600);
    expect(await is_answering(socket)).toBe(true);
  });

  it("refuses while another daemon answers, and replaces a socket left by one that died", async () => {
    const socket = join(folder, "daemon.sock");
    await listen_on_socket(socket, serve((_, response) => response.end()).listen);
    await expect(listen_on_socket(socket, serve((_, response) => response.end()).listen)).rejects.toBeInstanceOf(DaemonRunningError);

    await new Promise((resolve) => servers.shift()!.close(resolve));
    writeFileSync(socket, "");
    expect(await is_answering(socket)).toBe(false);
    await listen_on_socket(socket, serve((_, response) => response.end()).listen);
    expect(await is_answering(socket)).toBe(true);
  });
});

describe("daemon builds", () => {
  it("records the build that listens, from its entry file's contents", async () => {
    const socket = join(folder, "daemon.sock");
    const script = join(folder, "daemon.mjs");
    writeFileSync(script, "// build one\n");
    await listen_on_socket(socket, serve((_, response) => response.end()).listen, script);

    expect(read_daemon_build(socket)).toEqual({ pid: process.pid, build: daemon_build_id(script) });
    expect(statSync(daemon_build_path(socket)).mode & 0o777).toBe(0o600);
    writeFileSync(script, "// build two\n");
    expect(daemon_build_id(script)).not.toBe(read_daemon_build(socket)!.build);
  });

  it("records nothing for an entry file it cannot read, and reads nothing from a broken record", async () => {
    const socket = join(folder, "daemon.sock");
    writeFileSync(daemon_build_path(socket), "{}");
    await listen_on_socket(socket, serve((_, response) => response.end()).listen, join(folder, "missing.mjs"));

    expect(daemon_build_id(join(folder, "missing.mjs"))).toBeNull();
    expect(read_daemon_build(socket)).toBeNull();
    writeFileSync(daemon_build_path(socket), "not json");
    expect(read_daemon_build(socket)).toBeNull();
  });
});

describe("call_daemon", () => {
  it("posts the arguments as a JSON array and answers with the reply", async () => {
    const socket = join(folder, "daemon.sock");
    await listen_on_socket(socket, serve((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        if (request.url === "/api/add") return response.end(JSON.stringify((JSON.parse(body) as number[]).reduce((a, b) => a + b)));
        if (request.url === "/api/nothing") return response.writeHead(204).end();
        response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ message: "no call named that" }));
      });
    }).listen);

    expect(await call_daemon(socket, "/api/add", [2, 3])).toBe(5);
    expect(await call_daemon(socket, "/api/nothing")).toBeUndefined();
    await expect(call_daemon(socket, "/api/missing")).rejects.toThrow("no call named that");
  });
});

describe("follow_daemon_events", () => {
  it("hands over each event and reconnects when the daemon comes back", async () => {
    const socket = join(folder, "daemon.sock");
    const streams: import("node:http").ServerResponse[] = [];
    const handler: Parameters<typeof createServer>[1] = (_, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": hi\n\nevent: hello\ndata: client-1\n\n");
      streams.push(response);
    };
    await listen_on_socket(socket, serve(handler).listen);

    const events: string[] = [];
    let connects = 0;
    const stop = follow_daemon_events(socket, "/api/events", (event, data) => events.push(`${event}:${data}`), { retry_ms: 20, on_connect: () => connects++ });
    await wait_for(() => events.length === 1);
    streams[0]!.write("event: changed\ndata: \n\n");
    await wait_for(() => events.length === 2);
    expect(events).toEqual(["hello:client-1", "changed:"]);

    streams[0]!.end();
    await new Promise((resolve) => servers.shift()!.close(resolve));
    await listen_on_socket(socket, serve(handler).listen);
    await wait_for(() => connects === 2 && events.length === 3);
    stop();
  });

  it("reads names, joined data lines and comments", () => {
    expect(parse_event("event: changed\ndata: a\ndata: b")).toEqual({ event: "changed", data: "a\nb" });
    expect(parse_event("data: plain")).toEqual({ event: "message", data: "plain" });
    expect(parse_event(": keep open")).toBeNull();
  });
});

describe("start_daemon", () => {
  it("starts the script apart from this process and waits until it answers", async () => {
    const socket = join(folder, "daemon.sock");
    const script = join(folder, "daemon.mjs");
    writeFileSync(script, `import { createServer } from "node:http";\nconst server = createServer((_, r) => r.end("ok")).listen(process.env.SOCKET);\nprocess.on("SIGTERM", () => server.close(() => process.exit(0)));\nsetTimeout(() => process.exit(0), 10000);\n`);
    const log_file = join(folder, "logs", "daemon.log");

    expect(await start_daemon({ socket_path: socket, script, env: { SOCKET: socket }, log_file })).toBe("started");
    expect(await start_daemon({ socket_path: socket, script, env: { SOCKET: socket }, log_file })).toBe("running");
  });

  it("hands the daemon nothing but its output beyond the first three descriptors", async () => {
    const socket = join(folder, "daemon.sock");
    const script = join(folder, "daemon.mjs");
    const report = join(folder, "fds.json");
    writeFileSync(script, `import { readdirSync, readlinkSync, writeFileSync } from "node:fs";\nimport { createServer } from "node:http";\nconst fds = readdirSync("/proc/self/fd").filter((fd) => Number(fd) >= 3 && Number(fd) <= 5).map((fd) => { try { return readlinkSync("/proc/self/fd/" + fd); } catch { return ""; } });\nwriteFileSync(process.env.REPORT, JSON.stringify(fds));\nconst server = createServer((_, r) => r.end()).listen(process.env.SOCKET);\nsetTimeout(() => process.exit(0), 3000);\n`);
    await start_daemon({ socket_path: socket, script, env: { SOCKET: socket, REPORT: report }, log_file: join(folder, "daemon.log") });
    expect((JSON.parse(readFileSync(report, "utf8")) as string[]).every((target) => target === "/dev/null" || !target.startsWith("socket:"))).toBe(true);
  });

  it("covers every descriptor slot above the first three", () => {
    const fd_folder = join(folder, "fd");
    mkdirSync(fd_folder);
    for (const name of ["0", "1", "2", "3", "7"]) writeFileSync(join(fd_folder, name), "");
    expect(covered_descriptors(9, fd_folder)).toEqual([9, 9, 9, 9, 9]);
    expect(covered_descriptors(9, join(folder, "missing"))).toEqual([]);
  });

  it("says why when the daemon dies before answering", async () => {
    const script = join(folder, "broken.mjs");
    writeFileSync(script, `console.error("no database given");\nprocess.exit(3);\n`);
    await expect(start_daemon({ socket_path: join(folder, "daemon.sock"), script, log_file: join(folder, "daemon.log") })).rejects.toThrow("exited with 3: no database given");
  });

  it("replaces a daemon of another build only when asked, and leaves its own build running", async () => {
    const socket = join(folder, "daemon.sock");
    const log_file = join(folder, "daemon.log");
    // Each records its own build beside the socket, as listen_on_socket does.
    const daemon_source = (name: string) =>
      `// ${name}\nimport { createHash } from "node:crypto";\nimport { readFileSync, writeFileSync } from "node:fs";\nimport { createServer } from "node:http";\n` +
      `const server = createServer((_, r) => r.end()).listen(process.env.SOCKET, () => writeFileSync(process.env.SOCKET + ".build.json", JSON.stringify({ pid: process.pid, build: createHash("sha256").update(readFileSync(process.argv[1])).digest("hex").slice(0, 16) })));\n` +
      `process.on("SIGTERM", () => server.close(() => process.exit(0)));\nsetTimeout(() => process.exit(0), 10000);\n`;
    const old_build = join(folder, "old.mjs");
    const new_build = join(folder, "new.mjs");
    writeFileSync(old_build, daemon_source("old"));
    writeFileSync(new_build, daemon_source("new"));
    const start = (script: string, replace_other_build?: boolean) => start_daemon({ socket_path: socket, script, env: { SOCKET: socket }, log_file, replace_other_build });

    expect(await start(old_build)).toBe("started");
    await wait_for(() => read_daemon_build(socket) !== null);
    const old_pid = read_daemon_build(socket)!.pid;
    expect(await start(new_build)).toBe("running");

    expect(await start(new_build, true)).toBe("replaced");
    await wait_for(() => read_daemon_build(socket)?.build === daemon_build_id(new_build));
    expect(() => process.kill(old_pid, 0)).toThrow();
    expect(await start(new_build, true)).toBe("running");
    process.kill(read_daemon_build(socket)!.pid, "SIGTERM");
  });

  it("leaves running a daemon that recorded no build", async () => {
    const socket = join(folder, "daemon.sock");
    const script = join(folder, "daemon.mjs");
    writeFileSync(script, "// some build\n");
    await listen_on_socket(socket, serve((_, response) => response.end()).listen, join(folder, "missing.mjs"));

    expect(await start_daemon({ socket_path: socket, script, log_file: join(folder, "daemon.log"), replace_other_build: true })).toBe("running");
  });
});
