import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { start_agent, type AgentConfig, type RunningAgent } from "../../src/agent/client.ts";
import { encode_message, key_host_header, protocol_version, type AppMessage } from "../../src/agent/protocol.ts";
import { AgentHub, close_codes, type AgentTokenLookup } from "../../src/server/agents/hub.ts";
import { LocalAgent } from "../../src/server/agents/local.ts";
import { register_agent_route } from "../../src/server/agents/route.ts";
import { make_key } from "../test_keys.ts";

const agent_main = join(import.meta.dirname, "../agent_main.ts");
const app_name = "x-test";

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
let hub: AgentHub;
let tokens: Tokens;
let messages: { host: string; message: AppMessage }[];
let url: string;
let folder: string;
let token_file: string;
let state_directory: string;
let agent: RunningAgent | null;
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

function start_test_agent(extra: Partial<AgentConfig> = {}): RunningAgent {
  agent = start_agent({
    app: app_name, url, token_file, state_directory, host: "odin-box", agent_version: "test",
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
    app: app_name, tokens, connection: { window_in_bytes: 64 * 1024 },
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
      socket.send(encode_message({ type: "hello", protocol: protocol_version + 1, host: "thor", agent_version: "9", runs: [] }));
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
    const local = new AgentHub({ app: app_name, local: { host: "local", agent: new LocalAgent(state_directory) } });

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

  function start_key_agent(private_file = key.private_file): RunningAgent {
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

      socket.send(encode_message({ type: "hello", protocol: protocol_version, host: "odin", agent_version: "test", runs: [], signature }));

      expect((await closed).code).toBe(close_codes.bad_key);
      expect(hub.is_connected("odin")).toBe(false);
    }
  });

  it("refuses a key login for a host with no declared key, or for the server's own host", () => {
    const header = key_host_header(app_name);
    const local = new AgentHub({ app: app_name, local: { host: "heimdall", agent: new LocalAgent(state_directory) } });

    expect(hub.admit({ [header]: "thor" })).toEqual({ error: "Host 'thor' has no declared agent key." });
    expect(local.admit({ [header]: "heimdall" })).toEqual({ error: "'heimdall' is the server's own host, which needs no agent." });
    expect(local.admit({ authorization: "Bearer xt_any" })).toEqual({ error: `Name the host in the ${header} header.` });
  });

  it("refuses a token login for a host with a declared key, even with a valid token", async () => {
    expect(hub.admit({ authorization: `Bearer ${[...tokens.hosts.keys()][0]}` })).toEqual({
      error: "Host 'odin' has a declared agent key, so it logs in with that key, not a token.",
    });
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
    const local = new LocalAgent(state_directory, { requests: { health: () => ({ cpus: 2 }) } });
    const local_hub = new AgentHub({ app: app_name, local: { host: "server", agent: local } });

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
