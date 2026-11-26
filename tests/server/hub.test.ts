import { type ChildProcess, spawn } from "node:child_process";
import { request as http_request } from "node:http";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { start_agent, type AgentConfig, type RunningAgent } from "../../src/agent/client.ts";
import { fingerprint_of, parse_private_key, parse_server_keys } from "../../src/agent/keys.ts";
import { LongRuns } from "../../src/agent/long_runs.ts";
import { AgentSession, server_refused_close_code } from "../../src/agent/session.ts";
import {
  encode_message, key_host_header, most_hello_text_length, most_runs_in_hello, shell_app, type AgentApp, type AppMessage, type LongRun,
} from "../../src/agent/protocol.ts";
import { shell_runner } from "../../src/agent/tasks.ts";
import {
  admission_refused, AgentHub, close_codes, pre_login_message_limit_in_bytes, too_many_pending_logins, type AgentTokenLookup, type HubOptions,
} from "../../src/server/agents/hub.ts";
import type { ServerSocket } from "../../src/server/agents/connection.ts";
import { LocalAgent } from "../../src/server/agents/local.ts";
import { register_agent_route } from "../../src/server/agents/route.ts";
import { make_key } from "../test_keys.ts";

const agent_main = join(import.meta.dirname, "../agent_main.ts");
const app_name = "x-test";
const agent_app = shell_app(app_name);
const runner = shell_runner("x-test-run");

// The tokens an app issued, kept in memory.
class Tokens implements AgentTokenLookup {
  readonly hosts = new Map<string, string>();
  readonly seen_hosts: string[] = [];

  issue(host: string): string {
    const token = `xt_${randomBytes(16).toString("hex")}`;
    for (const [existing, owner] of this.hosts) if (owner === host) this.hosts.delete(existing);
    this.hosts.set(token, host);
    return token;
  }

  host_for(token: string): string | null {
    return this.hosts.get(token) ?? null;
  }

  seen(host: string): void {
    this.seen_hosts.push(host);
  }
}

let app: FastifyInstance;
let hub: AgentHub<string>;
let tokens: Tokens;
let messages: { host: string; message: AppMessage }[];
let url: string;
let folder: string;
let token_file: string;
let state_directory: string;
let agent: RunningAgent<string> | null;
let processes: ChildProcess[];

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connected(host = "odin") {
  return new Promise<void>((resolve) => {
    if (hub.is_connected(host)) resolve();
    const listener = (status: { host: string }) => {
      if (status.host !== host) return;
      hub.off("connect", listener);
      resolve();
    };
    hub.on("connect", listener);
  });
}

function start_test_agent(extra: Partial<AgentConfig<string>> = {}): RunningAgent<string> {
  agent = start_agent({
    app: agent_app, runner, url, token_file, state_directory, host: "odin-box", agent_version: "test",
    backoff_initial_in_milliseconds: 50, backoff_longest_in_milliseconds: 200,
    long_runs: { kill_grace_in_milliseconds: 300, tail_interval_in_milliseconds: 20 },
    log: () => {},
    ...extra,
  });
  return agent;
}

// Starts the agent as its own process, as it runs on a host.
function start_agent_process(env: Record<string, string> = { X_TEST_AGENT_TOKEN_FILE: token_file }): ChildProcess {
  const child = spawn(process.execPath, [agent_main], {
    env: { ...process.env, X_TEST_AGENT_URL: url, X_TEST_AGENT_STATE_DIR: state_directory, ...env },
    stdio: "ignore",
  });
  processes.push(child);
  return child;
}

async function ended(run_id: string) {
  for (;;) {
    const poll = await hub.poll("odin", run_id, 0);
    if (!poll.alive) return poll;
    await sleep(25);
  }
}

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "x-libs-hub-"));
  token_file = join(folder, "token");
  state_directory = join(folder, "agent");
  processes = [];
  agent = null;
  messages = [];
  tokens = new Tokens();
  hub = new AgentHub({
    app: agent_app, tokens, connection: { window_in_bytes: 64 * 1024 },
    on_message: (host, message, connection) => {
      messages.push({ host, message });
      if (message.type === "pulls") connection.send({ type: "pulls_received", count: (message.pulls as unknown[]).length });
    },
  });
  app = fastify();
  await register_agent_route(app, hub);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  url = `ws://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/api/agent`;
  writeFileSync(token_file, `${tokens.issue("odin")}\n`);
});

afterEach(async () => {
  await agent?.stop();
  for (const child of processes) child.kill("SIGKILL");
  await app.close();
});

describe("agent hub", () => {
  it("runs a command on a connected agent", async () => {
    start_test_agent();
    await connected();

    expect(hub.status("odin")).toMatchObject({ host: "odin", reported_host: "odin-box", agent_version: "test", built_in: false, login: "token" });
    expect(await hub.run("odin", "echo hello; echo warn >&2; exit 2", { timeout_in_seconds: 5 })).toEqual({ exit_code: 2, stdout: "hello", stderr: "warn" });
  });

  it("feeds stdin to the command", async () => {
    start_test_agent();
    await connected();

    expect((await hub.run("odin", "cat", { timeout_in_seconds: 5, stdin: "passphrase\n" })).stdout).toBe("passphrase");
  });

  it("stops a command that runs past its timeout", async () => {
    start_test_agent();
    await connected();

    expect(await hub.run("odin", "sleep 30", { timeout_in_seconds: 0.3 })).toEqual({ exit_code: -1, stdout: "", stderr: "Timed out after 0.3s" });
  });

  it("streams a large output whole, within the credit the reader allows", async () => {
    start_test_agent();
    await connected();

    const size = 8 * 1024 * 1024;
    const stream = hub.stream("odin", `head -c ${size} /dev/zero | tr '\\0' x`);
    let received = 0;
    let wrong = false;
    // A slow reader, so the agent has to wait for credit.
    const reader = new Writable({
      highWaterMark: 16 * 1024,
      write(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (chunk.some((byte) => byte !== 0x78)) wrong = true;
        setImmediate(callback);
      },
    });
    stream.stdout.pipe(reader);

    expect(await stream.done).toEqual({ exit_code: 0, stderr: "" });
    // The reader may still hold queued chunks when the run settles.
    await finished(reader);
    expect(received).toBe(size);
    expect(wrong).toBe(false);
  });

  it("stops a stream whose reader stopped reading", async () => {
    start_test_agent();
    await connected();

    const stream = hub.stream("odin", "yes x-libs");
    stream.stdout.pipe(new Writable({ highWaterMark: 16, write: () => {} }));
    await sleep(100);
    stream.stop();

    expect((await stream.done).exit_code).not.toBe(0);
    // The connection is still good for more.
    expect((await hub.run("odin", "echo still here", { timeout_in_seconds: 5 })).stdout).toBe("still here");
  });

  it("keeps a long run going across a dropped connection and reports it on reconnect", async () => {
    start_test_agent();
    await connected();
    await hub.start("odin", "survivor", "echo begin; sleep 0.5; echo end", {});

    const reconnected = new Promise<{ runs: unknown[] }>((resolve) => hub.once("connect", resolve));
    hub.disconnect("odin");
    const status = await reconnected;

    expect(status.runs).toMatchObject([{ run_id: "survivor", state: "running" }]);
    const poll = await ended("survivor");
    expect(poll).toMatchObject({ state: "exited", exit_code: 0, new_output: "begin\nend\n" });
  });

  it("follows a long run's output to its end", async () => {
    start_test_agent();
    await connected();
    await hub.start("odin", "ticks", "for i in 1 2 3; do echo $i; sleep 0.05; done", {});

    const stream = hub.attach("odin", "ticks", 0);
    const chunks: Buffer[] = [];
    stream.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    expect(await stream.done).toEqual({ exit_code: 0, stderr: "" });
    expect(Buffer.concat(chunks).toString()).toBe("1\n2\n3\n");
  });

  it("stops a long run", async () => {
    start_test_agent();
    await connected();
    await hub.start("odin", "endless", "sleep 30", {});

    expect(await hub.stop("odin", "endless")).toMatchObject({ run_id: "endless", state: "stopped" });
    expect(await hub.runs("odin")).toMatchObject([{ run_id: "endless", state: "stopped" }]);
    await hub.forget("odin", "endless");
    expect(await hub.runs("odin")).toEqual([]);
    await expect(hub.poll("odin", "endless", 0)).rejects.toThrow(/No run named/);
  });

  it("re-adopts a long run after the agent itself restarts", async () => {
    const first = start_agent_process();
    await connected();
    await hub.start("odin", "outlives", "echo one; sleep 1; echo two", {});

    const gone = once(hub, "disconnect");
    first.kill("SIGKILL");
    await gone;
    expect(hub.is_connected("odin")).toBe(false);

    const reconnected = new Promise<{ runs: unknown[] }>((resolve) => hub.once("connect", resolve));
    start_agent_process();
    const status = await reconnected;

    expect(status.runs).toMatchObject([{ run_id: "outlives", state: "running" }]);
    expect(await ended("outlives")).toMatchObject({ state: "exited", exit_code: 0, new_output: "one\ntwo\n" });
  });

  it("refuses a token nobody was issued, and hangs up on a revoked one", async () => {
    const socket = new WebSocket(url, { headers: { authorization: "Bearer xt_wrong" } } as unknown as string[]);
    let opened = false;
    socket.addEventListener("open", () => (opened = true));
    socket.addEventListener("error", () => {});
    await once(socket, "close");
    expect(opened).toBe(false);

    start_test_agent();
    await connected();
    tokens.hosts.clear();
    hub.disconnect_token_login("odin", "The host's token was revoked.");
    await sleep(300);
    expect(hub.is_connected("odin")).toBe(false);
    expect(agent!.connected()).toBe(false);
  });

  it("hangs up on an agent speaking another protocol version", async () => {
    const token = tokens.issue("thor");
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } } as unknown as string[]);
    socket.addEventListener("open", () => {
      socket.send(encode_message({ type: "hello", protocol: agent_app.protocol_version + 1, host: "thor", agent_version: "9", runs: [] }, agent_app));
    });
    const [event] = await once(socket, "close") as [CloseEvent];
    expect(event.code).toBe(close_codes.protocol);
    expect(hub.is_connected("thor")).toBe(false);
  });

  it("answers for a host with no agent without running anything", async () => {
    expect(await hub.run("nobody", "true", { timeout_in_seconds: 1 })).toMatchObject({ exit_code: -1, stderr: "No agent is connected for nobody." });
    expect((await hub.stream("nobody", "true").done).exit_code).toBe(-1);
    await expect(hub.runs("nobody")).rejects.toMatchObject({ unreachable: true });
  });

  it("tells the app's token store when an agent that logged in with a token hangs up", async () => {
    start_test_agent();
    await connected();

    const gone = new Promise((resolve) => hub.once("disconnect", resolve));
    await agent!.stop();
    agent = null;
    await gone;

    expect(tokens.seen_hosts).toEqual(["odin"]);
  });

  it("moves its built-in agent to the host the config names as the server's own", () => {
    const local = new AgentHub({ app: agent_app, local: { host: "local", agent: new LocalAgent(state_directory, { runner }) } });

    local.set_local_host("heimdall");

    expect(local.is_connected("heimdall")).toBe(true);
    expect(local.is_connected("local")).toBe(false);
    expect(local.status("heimdall")).toMatchObject({ host: "heimdall", built_in: true });
  });
});

describe("app messages", () => {
  it("answers the app's own requests, and refuses one the agent does not know", async () => {
    start_test_agent({ requests: { health: (message) => ({ cpus: 4, asked: message.detail ?? null }) } });
    await connected();

    expect(await hub.request("odin", "health", { detail: "load" })).toEqual({ cpus: 4, asked: "load" });
    await expect(hub.request("odin", "format_disk")).rejects.toThrow("This agent does not know the request 'format_disk'.");
  });

  it("carries the app's messages each way, as for reports sent once the hello is out", async () => {
    const received: AppMessage[] = [];
    start_test_agent({
      on_hello: (session) => session.send({ type: "pulls", pulls: [{ run_id: "a" }, { run_id: "b" }] }),
      on_message: (message) => received.push(message),
    });
    await connected();
    while (received.length === 0) await sleep(20);

    expect(messages).toEqual([{ host: "odin", message: { type: "pulls", pulls: [{ run_id: "a" }, { run_id: "b" }] } }]);
    expect(received).toEqual([{ type: "pulls_received", count: 2 }]);
  });
});

describe("agent key login", () => {
  let key: { private_file: string; public_line: string };

  beforeEach(() => {
    key = make_key(folder, "odin");
    hub.set_agent_keys(new Map([["odin", key.public_line]]));
  });

  function start_key_agent(private_file = key.private_file): RunningAgent<string> {
    return start_test_agent({ token_file: undefined, key_file: private_file, host: "odin" });
  }

  // Opens a socket that names the host for a key login, with the first message the server sends.
  async function open_key_socket(): Promise<{ socket: WebSocket; challenge: { nonce: string } }> {
    const socket = new WebSocket(url, { headers: { [key_host_header(app_name)]: "odin" } } as unknown as string[]);
    const first = new Promise<MessageEvent>((resolve) => socket.addEventListener("message", resolve, { once: true }));
    return { socket, challenge: JSON.parse(String((await first).data)) };
  }

  it("connects a real agent that signs the server's challenge with its key", async () => {
    start_key_agent();
    await connected();

    expect(hub.status("odin")).toMatchObject({ host: "odin", reported_host: "odin", login: "key" });
    expect(hub.declared_hosts()).toEqual(["odin"]);
    expect((await hub.run("odin", "echo signed in", { timeout_in_seconds: 5 })).stdout).toBe("signed in");
  });

  it("connects an agent process started with its key file", async () => {
    start_agent_process({ X_TEST_AGENT_KEY_FILE: key.private_file, X_TEST_AGENT_HOST: "odin" });

    await connected();

    expect(hub.status("odin")?.login).toBe("key");
  });

  it("refuses an agent holding another key", async () => {
    const other = make_key(folder, "other");
    let connections = 0;
    const listener = () => connections++;
    hub.on("connect", listener);

    start_key_agent(other.private_file);
    await sleep(400);

    hub.off("connect", listener);
    expect(connections).toBe(0);
    expect(hub.is_connected("odin")).toBe(false);
  });

  it("closes a socket whose hello carries a wrong signature, or none", async () => {
    for (const signature of ["AAAA", undefined]) {
      const { socket, challenge } = await open_key_socket();
      expect(challenge).toMatchObject({ type: "challenge", nonce: expect.any(String) });
      const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener("close", resolve, { once: true }));

      socket.send(encode_message({ type: "hello", protocol: agent_app.protocol_version, host: "odin", agent_version: "test", runs: [], signature }, agent_app));

      expect((await closed).code).toBe(close_codes.bad_key);
      expect(hub.is_connected("odin")).toBe(false);
    }
  });

  it("refuses a key login for a host with no declared key, or for the server's own host", () => {
    const header = key_host_header(app_name);
    const local = new AgentHub({ app: agent_app, local: { host: "heimdall", agent: new LocalAgent(state_directory, { runner }) } });

    expect(hub.admit({ [header]: "thor" })).toMatchObject({ error: admission_refused });
    expect(local.admit({ [header]: "heimdall" })).toMatchObject({ error: admission_refused });
    expect(local.admit({ authorization: "Bearer xt_any" })).toMatchObject({ error: admission_refused });
  });

  it("refuses a token login for a host with a declared key, even with a valid token", async () => {
    expect(hub.admit({ authorization: `Bearer ${[...tokens.hosts.keys()][0]}` })).toMatchObject({ error: admission_refused, reason: expect.stringContaining("declared agent key") });
    start_test_agent();
    await sleep(300);
    expect(hub.is_connected("odin")).toBe(false);
  });

  it("hangs up on an agent logged in with a token once its host's key is declared", async () => {
    hub.set_agent_keys(new Map());
    start_test_agent();
    await connected();
    const gone = new Promise((resolve) => hub.once("disconnect", resolve));

    hub.set_agent_keys(new Map([["odin", key.public_line]]));

    await gone;
    await sleep(300);
    expect(hub.is_connected("odin")).toBe(false);
  });

  it("keeps a key login when the host's token is replaced", async () => {
    start_key_agent();
    await connected();

    hub.disconnect_token_login("odin", "The host's token was replaced.");

    expect(hub.status("odin")?.login).toBe("key");
  });
});

describe("local agent", () => {
  it("answers through the hub as the server's own host, with no socket", async () => {
    const local = new LocalAgent(state_directory, { runner, requests: { health: () => ({ cpus: 2 }) } });
    const local_hub = new AgentHub({ app: agent_app, local: { host: "server", agent: local } });

    expect(local_hub.is_connected("server")).toBe(true);
    expect(await local_hub.run("server", "cat", { timeout_in_seconds: 5, stdin: "secret\n" })).toEqual({ exit_code: 0, stdout: "secret", stderr: "" });
    expect(await local_hub.request("server", "health")).toEqual({ cpus: 2 });
    await expect(local_hub.request("server", "format_disk")).rejects.toThrow(/does not know/);

    await local_hub.start("server", "local-run", "echo hi", {});
    const stream = local_hub.attach("server", "local-run", 0);
    const chunks: Buffer[] = [];
    stream.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    expect((await stream.done).exit_code).toBe(0);
    expect(Buffer.concat(chunks).toString()).toBe("hi\n");
    expect((await local_hub.attach("server", "missing", 0).done).stderr).toMatch(/No run named/);
    await expect(local_hub.poll("server", "missing", 0)).rejects.toMatchObject({ name: "AgentError", unreachable: false });
  });
});

describe("typed tasks", () => {
  // An app whose tasks are typed operations, sent in an `operation` field under its own protocol version.
  interface Operation {
    kind: "echo";
    words: string[];
  }

  const typed_app: AgentApp<Operation> = {
    name: "x-typed",
    protocol_version: 2,
    task_field: "operation",
    is_task: (value): value is Operation => typeof value === "object" && value !== null && (value as Operation).kind === "echo",
  };

  it("carries the app's own tasks to its own runner, over the wire and in long runs", async () => {
    const typed_hub = new AgentHub({ app: typed_app });
    const typed_server = fastify();
    await register_agent_route(typed_server, typed_hub);
    await typed_server.listen({ host: "127.0.0.1", port: 0 });
    const address = typed_server.server.address();
    const typed_url = `ws://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/api/agent`;
    const key = make_key(folder, "typed");
    typed_hub.set_agent_keys(new Map([["odin", key.public_line]]));
    const typed_agent = start_agent({
      app: typed_app, url: typed_url, key_file: key.private_file, state_directory, host: "odin", agent_version: "test",
      runner: {
        run: async (task) => ({ exit_code: 0, stdout: task.words.join(" "), stderr: "" }),
        launch: (task, run_folder) => ({ program: "sh", args: ["-c", 'echo "$2" > "$1/out"; echo 0 > "$1/exit"', "x-typed-run", run_folder, task.words.join(" ")] }),
      },
      backoff_initial_in_milliseconds: 50, log: () => {},
    });
    try {
      while (!typed_hub.is_connected("odin")) await sleep(20);

      expect(await typed_hub.run("odin", { kind: "echo", words: ["typed", "hello"] }, { timeout_in_seconds: 5 })).toEqual({ exit_code: 0, stdout: "typed hello", stderr: "" });
      await typed_hub.start("odin", "typed-run", { kind: "echo", words: ["long", "run"] });
      let poll = await typed_hub.poll("odin", "typed-run", 0);
      while (poll.alive) poll = await typed_hub.poll("odin", "typed-run", 0);
      expect(poll).toMatchObject({ exit_code: 0, new_output: "long run\n" });
      const stream = typed_hub.stream("odin", { kind: "echo", words: [] });
      stream.stdout.resume();
      expect((await stream.done).stderr).toBe("This agent does not stream its tasks.");
    } finally {
      await typed_agent.stop();
      await typed_server.close();
    }
  });
});

describe("before login", () => {
  function port_of(server: FastifyInstance): number {
    const address = server.server.address();
    return typeof address === "object" && address !== null ? address.port : 0;
  }

  // Opens a socket with a token for the host, resolving once it is open.
  async function open_token_socket(host: string, socket_url = url): Promise<WebSocket> {
    const socket = new WebSocket(socket_url, { headers: { authorization: `Bearer ${tokens.issue(host)}` } } as unknown as string[]);
    socket.addEventListener("error", () => {});
    await once(socket, "open");
    return socket;
  }

  function closed(socket: WebSocket): Promise<CloseEvent> {
    return new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));
  }

  // The HTTP status an upgrade with these headers is answered, 101 when it is taken, with its body.
  function upgrade_status(port: number, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const outgoing = http_request({
        host: "127.0.0.1", port, path: "/api/agent",
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": randomBytes(16).toString("base64"), ...headers },
      });
      outgoing.on("upgrade", (_response, socket) => {
        socket.destroy();
        resolve({ status: 101, body: "" });
      });
      outgoing.on("response", (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  it("answers every refused upgrade alike, without naming the host it was given", async () => {
    hub.set_agent_keys(new Map([["odin", make_key(folder, "odin").public_line]]));
    const port = port_of(app);

    const unknown_host = await upgrade_status(port, { [key_host_header(app_name)]: "secret-host-name" });
    const unknown_token = await upgrade_status(port, { authorization: "Bearer xt_wrong" });
    const keyed_token = await upgrade_status(port, { authorization: `Bearer ${tokens.issue("odin")}` });

    for (const answer of [unknown_host, unknown_token, keyed_token]) expect(answer).toEqual({ status: 401, body: JSON.stringify({ error: admission_refused }) });
  });

  it("closes a socket whose first message is not a hello, or is binary", async () => {
    for (const first of [encode_message({ type: "ping", epoch_ms: 1 }, agent_app), "not json", new Uint8Array([1, 2, 3])]) {
      const socket = await open_token_socket("thor");
      const ending = closed(socket);
      socket.send(first);
      expect((await ending).code).toBe(close_codes.not_hello);
    }
    const socket = await open_token_socket("thor");
    const ending = closed(socket);
    socket.send(JSON.stringify({ type: "hello", protocol: agent_app.protocol_version, host: "thor", agent_version: "1", runs: "many" }));
    expect((await ending).code).toBe(close_codes.not_hello);
    expect(hub.is_connected("thor")).toBe(false);
  });

  it("closes a socket that sends a message larger than a hello can be before login", async () => {
    const socket = await open_token_socket("thor");
    const ending = closed(socket);

    socket.send("x".repeat(pre_login_message_limit_in_bytes + 1));

    expect((await ending).code).toBe(close_codes.too_large);
  });

  it("refuses an oversized frame from its header alone, before its payload is read", async () => {
    const token = tokens.issue("thor");
    const raw = connect(port_of(app), "127.0.0.1");
    await once(raw, "connect");
    raw.write([
      "GET /api/agent HTTP/1.1", "Host: 127.0.0.1", "Connection: Upgrade", "Upgrade: websocket", "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`, `Authorization: Bearer ${token}`, "", "",
    ].join("\r\n"));
    let received = Buffer.alloc(0);
    raw.on("data", (chunk: Buffer) => (received = Buffer.concat([received, chunk])));
    while (!received.includes("\r\n\r\n")) await sleep(10);
    expect(received.toString().startsWith("HTTP/1.1 101")).toBe(true);
    const handshake_length = received.indexOf("\r\n\r\n") + 4;

    // A masked text frame whose header claims one mebibyte, with none of the payload sent.
    const header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(1024 * 1024), 2);
    raw.write(header);
    await once(raw, "close");

    const frame = received.subarray(handshake_length);
    expect(frame[0]).toBe(0x88);
    expect(frame.readUInt16BE(2)).toBe(close_codes.too_large);
  });

  it("takes messages up to the full size once the hello is accepted", async () => {
    const socket = await open_token_socket("thor");
    socket.send(encode_message({ type: "hello", protocol: agent_app.protocol_version, host: "thor", agent_version: "1", runs: [] }, agent_app));
    await connected("thor");

    socket.send(JSON.stringify({ type: "pulls", pulls: ["z".repeat(2 * pre_login_message_limit_in_bytes)] }));
    while (messages.length === 0) await sleep(10);

    expect(messages[0]).toMatchObject({ host: "thor", message: { type: "pulls" } });
    socket.close();
  });

  it("refuses upgrades past the limit on sockets still logging in, and takes them again once one logs in or leaves", async () => {
    const limited = new AgentHub({ app: agent_app, tokens, most_pending_logins: 3, most_pending_logins_per_address: 2 });
    const server = fastify();
    await register_agent_route(server, limited);
    await server.listen({ host: "127.0.0.1", port: 0 });
    const port = port_of(server);
    const limited_url = `ws://127.0.0.1:${port}/api/agent`;
    try {
      const first = await open_token_socket("thor", limited_url);
      const second = await open_token_socket("loki", limited_url);

      expect(await upgrade_status(port, { authorization: `Bearer ${tokens.issue("frey")}` })).toEqual({ status: 503, body: JSON.stringify({ error: too_many_pending_logins }) });

      first.send(encode_message({ type: "hello", protocol: agent_app.protocol_version, host: "thor", agent_version: "1", runs: [] }, agent_app));
      while (!limited.is_connected("thor")) await sleep(10);
      const third = await open_token_socket("frey", limited_url);

      const gone = closed(second);
      second.close();
      await gone;
      await sleep(50);
      const fourth = await open_token_socket("tyr", limited_url);
      for (const socket of [first, third, fourth]) socket.close();
    } finally {
      await server.close();
    }
  });

  it("closes an oversized message before login even on a socket whose frames it cannot limit", () => {
    const closes: number[] = [];
    let deliver: (data: Buffer, is_binary: boolean) => void = () => {};
    const socket = {
      readyState: 1,
      send: () => {},
      close: (code?: number) => void closes.push(code ?? 0),
      on: (event: string, listener: (data: Buffer, is_binary: boolean) => void) => {
        if (event === "message") deliver = listener;
      },
    };

    hub.accept(socket as unknown as ServerSocket, "thor", "token");
    deliver(Buffer.alloc(pre_login_message_limit_in_bytes + 1, 0x20), false);
    deliver(Buffer.from("{}"), false);

    expect(closes).toEqual([close_codes.too_large]);
  });

  it("refuses upgrades past the overall limit, whatever the address", () => {
    const limited = new AgentHub({ app: agent_app, most_pending_logins: 2, most_pending_logins_per_address: 5 });
    const releases = [limited.hold_pending_login("10.0.0.1"), limited.hold_pending_login("10.0.0.2")];

    expect(limited.hold_pending_login("10.0.0.3")).toBeNull();
    releases[0]!();
    releases[0]!();
    expect(limited.hold_pending_login("10.0.0.3")).not.toBeNull();
    expect(limited.hold_pending_login("10.0.0.4")).toBeNull();
  });

  it("keeps only the well-formed runs a hello lists, at most the limit, with its texts cut to length", async () => {
    const run = (index: number): LongRun => ({ run_id: `run-${index}`, pid: 100 + index, started_epoch: index, state: "running", exit_code: null });
    const runs: unknown[] = [];
    for (let index = 0; index < most_runs_in_hello + 50; index++) runs.push(run(index));
    runs.push({ run_id: "../escape", pid: 1, started_epoch: 1, state: "running", exit_code: null }, { run_id: "bad-state", pid: 1, started_epoch: 1, state: "zombie", exit_code: null });
    runs.push("junk", null, { ...run(9999), extra: "x".repeat(1000) });
    const socket = await open_token_socket("thor");
    const connecting = new Promise<{ runs: LongRun[]; agent_version: string; reported_host: string }>((resolve) => hub.once("connect", resolve));

    socket.send(JSON.stringify({ type: "hello", protocol: agent_app.protocol_version, host: "h".repeat(5000), agent_version: "v".repeat(5000), runs }));
    const status = await connecting;

    expect(status.agent_version.length).toBe(most_hello_text_length);
    expect(status.reported_host.length).toBe(most_hello_text_length);
    expect(status.runs.length).toBeLessThanOrEqual(most_runs_in_hello);
    expect(status.runs.every((each) => /^run-\d+$/.test(each.run_id))).toBe(true);
    expect(status.runs.at(-1)).toEqual(run(9999));
    socket.close();
  });

  it("turns an agent's malformed replies into errors to try again, and keeps only its well-formed runs", async () => {
    const socket = await open_token_socket("thor");
    socket.send(encode_message({ type: "hello", protocol: agent_app.protocol_version, host: "thor", agent_version: "1", runs: [] }, agent_app));
    await connected("thor");
    const good_run: LongRun = { run_id: "fine", pid: 7, started_epoch: 1, state: "exited", exit_code: 0 };
    const replies: Record<string, unknown> = {
      poll: { state: "running", exit_code: null, alive: true, size: 1e12, new_output: "x", next_offset: "0" },
      start: { run_id: "../../etc" },
      stop: "stopped",
      runs: [good_run, { run_id: "broken" }, 42],
      run: { exit_code: "0" },
    };
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; id?: string };
      if (message.id !== undefined && Object.hasOwn(replies, message.type)) socket.send(JSON.stringify({ type: "reply", id: message.id, value: replies[message.type] }));
    });

    await expect(hub.poll("thor", "r", 0)).rejects.toMatchObject({ name: "AgentError", unreachable: true, message: expect.stringContaining("malformed") });
    await expect(hub.start("thor", "r", "true")).rejects.toMatchObject({ unreachable: true });
    await expect(hub.stop("thor", "r")).rejects.toMatchObject({ unreachable: true });
    expect(await hub.runs("thor")).toEqual([good_run]);
    expect(await hub.run("thor", "true", { timeout_in_seconds: 1 })).toMatchObject({ exit_code: -1, stderr: expect.stringContaining("malformed") });
    socket.close();
  });
});

describe("server key", () => {
  let agent_key: { private_file: string; public_line: string };
  let server: { private_file: string; public_line: string };
  let logged: string[];

  // Replaces the test's hub with one built from these options, holding the given server key file.
  async function serve(server_key_file: string | null, options: Partial<HubOptions<string>> = {}): Promise<void> {
    await app.close();
    hub = new AgentHub({
      app: agent_app, tokens, connection: { window_in_bytes: 64 * 1024 },
      server_key: server_key_file === null ? null : parse_private_key(readFileSync(server_key_file, "utf8")), ...options,
    });
    hub.set_agent_keys(new Map([["odin", agent_key.public_line]]));
    app = fastify();
    await register_agent_route(app, hub);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    url = `ws://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/api/agent`;
  }

  function start_checking_agent(extra: Partial<AgentConfig<string>> = {}): RunningAgent<string> {
    return start_test_agent({
      token_file: undefined, key_file: agent_key.private_file, host: "odin", server_keys: [server.public_line], log: (line) => logged.push(line), ...extra,
    });
  }

  // Opens a key login socket for odin, with the first message the server sends.
  async function open_key_socket(): Promise<{ socket: WebSocket; first: string }> {
    const socket = new WebSocket(url, { headers: { [key_host_header(app_name)]: "odin" } } as unknown as string[]);
    socket.addEventListener("error", () => {});
    const first = new Promise<MessageEvent>((resolve) => socket.addEventListener("message", resolve, { once: true }));
    return { socket, first: String((await first).data) };
  }

  function closed(socket: WebSocket): Promise<CloseEvent> {
    return new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));
  }

  // A session for odin's agent whose socket keeps what it sends.
  function captured_session(): { session: AgentSession<string>; sent: string[] } {
    const sent: string[] = [];
    const socket = { readyState: 1, send: (data: string | Uint8Array<ArrayBuffer>) => void sent.push(String(data)), close: () => {} };
    const session = new AgentSession(socket, new LongRuns(mkdtempSync(join(folder, "relay-")), runner), {
      app: agent_app, runner, host: "odin", agent_version: "test", heartbeat_in_milliseconds: 60_000,
      key: parse_private_key(readFileSync(agent_key.private_file, "utf8")), server_keys: parse_server_keys([server.public_line]), log: () => {},
    });
    return { session, sent };
  }

  async function until(check: () => boolean): Promise<void> {
    while (!check()) await sleep(20);
  }

  beforeEach(async () => {
    logged = [];
    agent_key = make_key(folder, "odin-agent");
    server = make_key(folder, "server");
    await serve(server.private_file);
  });

  it("logs a checking agent in with a signed challenge and signs every request it sends it", async () => {
    start_checking_agent();
    await connected();

    expect(hub.status("odin")).toMatchObject({ login: "key", signed_messages: true });
    expect(hub.server_key_fingerprint()).toBe(fingerprint_of(parse_private_key(readFileSync(server.private_file, "utf8"))));
    expect(hub.server_public_line()).toBe(server.public_line.split(" ").slice(0, 2).join(" "));
    expect(await hub.run("odin", "cat", { timeout_in_seconds: 5, stdin: "secret\n" })).toEqual({ exit_code: 0, stdout: "secret", stderr: "" });
    await hub.start("odin", "signed-run", "echo started; sleep 30");
    expect((await hub.runs("odin")).map((run) => run.run_id)).toContain("signed-run");
    while ((await hub.poll("odin", "signed-run", 0)).new_output === "") await sleep(20);
    expect(await hub.stop("odin", "signed-run")).toMatchObject({ run_id: "signed-run", state: "stopped" });
    expect((await hub.poll("odin", "signed-run", 0)).new_output).toBe("started\n");
    await hub.forget("odin", "signed-run");
    const stream = hub.stream("odin", "seq 1 3");
    const chunks: Buffer[] = [];
    stream.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    expect((await stream.done).exit_code).toBe(0);
    expect(Buffer.concat(chunks).toString()).toBe("1\n2\n3\n");
    await expect(hub.request("odin", "format_disk")).rejects.toThrow(/does not know/);
    expect(logged.join("\n")).not.toMatch(/Refused|TLS alone/);
  });

  it("signs for a checking agent that logs in with a token", async () => {
    hub.set_agent_keys(new Map());
    start_checking_agent({ key_file: undefined, token_file });
    await connected();

    expect(hub.status("odin")).toMatchObject({ login: "token", signed_messages: true });
    expect((await hub.run("odin", "echo token", { timeout_in_seconds: 5 })).stdout).toBe("token");
  });

  it("keeps serving an agent that checks nothing, which warns that TLS alone proves the server", async () => {
    start_test_agent({ token_file: undefined, key_file: agent_key.private_file, host: "odin", log: (line) => logged.push(line) });
    await connected();

    expect(hub.status("odin")).toMatchObject({ login: "key", signed_messages: false });
    expect((await hub.run("odin", "echo plain", { timeout_in_seconds: 5 })).stdout).toBe("plain");
    expect(logged.filter((line) => /TLS alone/.test(line))).toHaveLength(1);
    await agent?.stop();
    await until(() => !hub.is_connected("odin"));
    hub.set_agent_keys(new Map());

    start_test_agent({ log: () => {} });
    await connected();
    expect(hub.status("odin")).toMatchObject({ login: "token", signed_messages: false });
    expect((await hub.run("odin", "echo plain token", { timeout_in_seconds: 5 })).stdout).toBe("plain token");
  });

  it("is refused by a checking agent, before it signs, when the server holds another key or none", async () => {
    let connections = 0;
    const count = () => connections++;
    for (const server_key_file of [make_key(folder, "impostor").private_file, null]) {
      await serve(server_key_file);
      hub.on("connect", count);
      logged = [];
      start_checking_agent();
      await until(() => logged.some((line) => line.startsWith("Refused the server")));
      await agent?.stop();
      agent = null;
    }

    expect(connections).toBe(0);
    expect(logged.join("\n")).toMatch(/did not sign its challenge/);
  });

  it("is refused by a checking agent logging in with a token when the server sends no challenge", async () => {
    await serve(null);
    hub.set_agent_keys(new Map());
    start_checking_agent({ key_file: undefined, token_file, challenge_timeout_in_milliseconds: 100 });

    await until(() => logged.some((line) => /No signed challenge came/.test(line)));
    expect(hub.is_connected("odin")).toBe(false);
  });

  it("turns away a hello relayed onto another connection, or stripped of the agent's nonce", async () => {
    const first = await open_key_socket();
    const { session, sent } = captured_session();
    session.receive(first.first);
    const hello = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(hello).toMatchObject({ type: "hello", agent_nonce: expect.any(String), signature: expect.any(String) });
    session.close();

    for (const relayed of [hello, { ...hello, agent_nonce: undefined }]) {
      const second = await open_key_socket();
      const ended = closed(second.socket);
      second.socket.send(JSON.stringify(relayed));
      expect((await ended).code).toBe(close_codes.bad_key);
    }
    first.socket.close();
    expect(hub.is_connected("odin")).toBe(false);
  });

  it("refuses to sign a challenge relayed from a server with another key", async () => {
    const first = await open_key_socket();
    const { session, sent } = captured_session();
    session.receive(first.first.replace(/"server_key":"[^"]+"/, `"server_key":"${fingerprint_of(parse_private_key(readFileSync(make_key(folder, "relay").private_file, "utf8")))}"`));

    expect(sent).toEqual([]);
    first.socket.close();
  });

  it("closes an agent's socket when a message reaches it out of order", async () => {
    const first = await open_key_socket();
    const sent: string[] = [];
    let close_code: number | null = null;
    const socket = {
      readyState: 1,
      send: (data: string | Uint8Array<ArrayBuffer>) => {
        sent.push(String(data));
        first.socket.send(data);
      },
      close: (code?: number) => {
        close_code = code ?? null;
      },
    };
    const session = new AgentSession(socket, new LongRuns(mkdtempSync(join(folder, "order-")), runner), {
      app: agent_app, runner, host: "odin", agent_version: "test", heartbeat_in_milliseconds: 60_000,
      key: parse_private_key(readFileSync(agent_key.private_file, "utf8")), server_keys: parse_server_keys([server.public_line]), log: () => {},
    });
    const frames: string[] = [];
    first.socket.addEventListener("message", (event) => frames.push(String(event.data)));
    session.receive(first.first);
    await connected();

    void hub.run("odin", "echo one", { timeout_in_seconds: 5 });
    void hub.run("odin", "echo two", { timeout_in_seconds: 5 });
    await until(() => frames.length >= 2);
    session.receive(frames[1]);

    expect(close_code).toBe(server_refused_close_code);
    expect(JSON.parse(sent.at(-1)!)).toMatchObject({ type: "failed", id: "r2", error: expect.stringMatching(/went from 0 to 2/) });
    session.close();
    first.socket.close();
  });

  it("turns away a hello asking for signed messages from a server with no key", async () => {
    await serve(null);
    const { socket, first } = await open_key_socket();
    const ended = closed(socket);

    socket.send(encode_message({ type: "hello", protocol: agent_app.protocol_version, host: "odin", agent_version: "test", runs: [], agent_nonce: "a".repeat(43) }, agent_app));

    expect(JSON.parse(first)).toEqual({ type: "challenge", nonce: expect.any(String) });
    expect((await ended).code).toBe(close_codes.bad_agent_nonce);
  });

  it("lets an agent listing two server keys log in to a server holding either", async () => {
    const next = make_key(folder, "next-server");
    for (const server_key_file of [server.private_file, next.private_file]) {
      await serve(server_key_file);
      start_checking_agent({ server_keys: [server.public_line, next.public_line] });
      await connected();
      expect((await hub.run("odin", "echo rotated", { timeout_in_seconds: 5 })).stdout).toBe("rotated");
      await agent?.stop();
      agent = null;
    }
  });

  it("answers for its own machine through the built-in agent, with no signing", async () => {
    const local = new LocalAgent(state_directory, { runner });
    await serve(server.private_file, { local: { host: "server", agent: local } });

    expect(hub.status("server")).toMatchObject({ built_in: true, signed_messages: false });
    expect(await hub.run("server", "cat", { timeout_in_seconds: 5, stdin: "local" })).toEqual({ exit_code: 0, stdout: "local", stderr: "" });
  });

  it("refuses to start an agent given a server key that is not an ed25519 public line", () => {
    expect(() => start_checking_agent({ server_keys: ["ssh-rsa AAAA"] })).toThrow(/Server key 1 must be an ssh-ed25519 key/);
  });
});
