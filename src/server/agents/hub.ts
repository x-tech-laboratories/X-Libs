// The agents the server can reach, by host name: those that have dialled in with their host's declared key or a token
// the app issued, and the one built into the server for its own machine. A host with a declared key logs in only with
// that key, so a leaked token cannot stand in for it.

// ── Imports ──────────────────────────────────────────────────────────────────

import { randomBytes, type KeyObject } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";

import { parse_public_key, verify_challenge } from "../../agent/keys.ts";
import {
  encode_message, is_agent_message, key_host_header, parse_agent_message, type AgentApp, type AppMessage, type LongRun, type LongRunPoll, type RunResult,
} from "../../agent/protocol.ts";
import { AgentError, ended_stream, type Agent, type AgentRunOptions, type AgentStreamOptions, type CommandStream } from "./agent.ts";
import { AgentConnection, type ConnectionOptions, type ServerSocket } from "./connection.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

// Where the app keeps the tokens it issued, for agents that log in with one.
export interface AgentTokenLookup {
  // The host the token belongs to, or null for a token nobody was issued.
  host_for(token: string): string | null;
  // Notes that the host's agent was in touch now, as when it hangs up.
  seen?(host: string): void;
}

export interface HubOptions<Task> {
  app: AgentApp<Task>;
  // The server's own machine, answered by an agent built into the server.
  local?: { host: string; agent: Agent<Task> };
  // Lets agents log in with a token; without it, only with a declared key.
  tokens?: AgentTokenLookup;
  // Takes the app's own messages from a connected agent.
  on_message?: (host: string, message: AppMessage, connection: AgentConnection<Task>) => void;
  // How long a new socket has to say hello.
  hello_timeout_in_milliseconds?: number;
  connection?: Partial<ConnectionOptions>;
}

// A connected agent as the page shows it.
export interface AgentStatus {
  host: string;
  // The name the agent gave itself, which may differ from the host it is enrolled as.
  reported_host: string;
  agent_version: string;
  connected_epoch: number;
  built_in: boolean;
  // How the agent logged in; null for the built-in one.
  login: AgentLogin | null;
  // The long runs the agent knew of when it connected.
  runs: LongRun[];
}

export type AgentLogin = "token" | "key";

// Who an agent's upgrade says it is, before any socket opens, or why it is turned away.
export type Admission = { host: string; login: AgentLogin } | { error: string };

interface HubEvents {
  connect: [status: AgentStatus];
  disconnect: [host: string];
}

// Close codes the hub hangs up with.
export const close_codes = {
  protocol: 4002,
  replaced: 4003,
  revoked: 4004,
  no_hello: 4005,
  bad_key: 4006,
} as const;

const default_connection: ConnectionOptions = {
  window_in_bytes: 1024 * 1024,
  request_timeout_in_milliseconds: 60_000,
  heartbeat_in_milliseconds: 15_000,
};

// ── Hub ──────────────────────────────────────────────────────────────────────

export class AgentHub<Task> extends EventEmitter<HubEvents> {
  readonly app: AgentApp<Task>;
  private readonly local: { host: string; readonly agent: Agent<Task> } | null;
  private readonly tokens: AgentTokenLookup | null;
  private readonly on_message: HubOptions<Task>["on_message"] | null;
  private readonly hello_timeout: number;
  private readonly connection_options: ConnectionOptions;
  private readonly connections = new Map<string, AgentConnection<Task>>();
  private readonly logins = new WeakMap<AgentConnection<Task>, AgentLogin>();
  // Each host's declared public key, with the line it was read from.
  private agent_keys = new Map<string, { line: string; key: KeyObject }>();

  constructor(options: HubOptions<Task>) {
    super();
    this.app = options.app;
    this.local = options.local === undefined ? null : { ...options.local };
    this.tokens = options.tokens ?? null;
    this.on_message = options.on_message ?? null;
    this.hello_timeout = options.hello_timeout_in_milliseconds ?? 10_000;
    this.connection_options = { ...default_connection, ...options.connection };
  }

  // The host the built-in agent answers for, which follows the config as it names this server's own host.
  set_local_host(host: string): void {
    if (this.local !== null) this.local.host = host;
  }

  // ── Enrolment ────────────────────────────────────────────────────────────

  // Takes each host's declared OpenSSH public key line, and hangs up on an agent whose host's key is new, changed or
  // gone, so it logs in again the way the config now asks.
  set_agent_keys(lines: Map<string, string>): void {
    const next = new Map([...lines].map(([host, line]) => [host, { line, key: parse_public_key(line) }]));
    for (const host of new Set([...this.agent_keys.keys(), ...next.keys()])) {
      if (this.agent_keys.get(host)?.line === next.get(host)?.line) continue;
      this.disconnect(host, close_codes.revoked, "The host's declared agent key changed.");
    }
    this.agent_keys = next;
  }

  has_agent_key(host: string): boolean {
    return this.agent_keys.has(host);
  }

  // The hosts with a declared key, in order.
  declared_hosts(): string[] {
    return [...this.agent_keys.keys()].sort();
  }

  // Hangs up on a host's agent that logged in with a token, as when the app replaces or revokes that token.
  disconnect_token_login(host: string, reason: string): void {
    const connection = this.connections.get(host);
    if (connection !== undefined && this.logins.get(connection) === "token") connection.close(close_codes.revoked, reason);
  }

  // The host an Authorization header's bearer token belongs to.
  authenticate(authorization: string | undefined): string | null {
    const match = /^Bearer\s+(\S+)$/.exec(authorization ?? "");
    return match === null || this.tokens === null ? null : this.tokens.host_for(match[1]);
  }

  // Who an agent's upgrade request says it is: the host it names to log in with that host's key, or a token's host.
  admit(headers: IncomingHttpHeaders): Admission {
    const header = key_host_header(this.app.name);
    const named = headers[header];
    if (typeof named === "string" && named !== "") {
      if (named === this.local?.host) return { error: `'${named}' is the server's own host, which needs no agent.` };
      if (!this.agent_keys.has(named)) return { error: `Host '${named}' has no declared agent key.` };
      return { host: named, login: "key" };
    }
    if (this.tokens === null) return { error: `Name the host in the ${header} header.` };
    const host = this.authenticate(headers.authorization);
    if (host === null) return { error: "This agent token is not enrolled." };
    if (this.agent_keys.has(host)) return { error: `Host '${host}' has a declared agent key, so it logs in with that key, not a token.` };
    return { host, login: "token" };
  }

  // ── Connections ──────────────────────────────────────────────────────────

  // Takes a socket whose upgrade named the host, and waits for its hello before using it; one logging in with its key
  // is sent a nonce first, which its hello must carry signed.
  accept(socket: ServerSocket, host: string, login: AgentLogin): void {
    let connection: AgentConnection<Task> | null = null;
    const hello_timer = setTimeout(() => socket.close(close_codes.no_hello, "No hello came."), this.hello_timeout);
    const nonce = login === "key" ? randomBytes(32).toString("base64url") : null;
    if (nonce !== null) socket.send(encode_message({ type: "challenge", nonce }, this.app));

    socket.on("message", (raw, is_binary) => {
      const data = as_buffer(raw);
      if (connection !== null) {
        connection.receive(data, is_binary);
        return;
      }
      const hello = is_binary ? null : parse_agent_message(data.toString("utf8"), this.app as AgentApp<unknown>);
      if (hello === null || !is_agent_message(hello) || hello.type !== "hello") return;
      clearTimeout(hello_timer);
      if (hello.protocol !== this.app.protocol_version) {
        socket.close(close_codes.protocol, `This server speaks agent protocol ${this.app.protocol_version}, not ${hello.protocol}.`);
        return;
      }
      const { signature, ...greeting } = hello;
      if (nonce !== null && !this.proves_key(host, nonce, signature)) {
        socket.close(close_codes.bad_key, `The agent's key is not the one declared for ${host}.`);
        return;
      }
      this.connections.get(host)?.close(close_codes.replaced, "A newer connection from the same host replaced this one.");
      const current = new AgentConnection(socket, this.app, host, greeting, this.connection_options);
      current.on_message = (message) => this.on_message?.(host, message, current);
      connection = current;
      this.connections.set(host, current);
      this.logins.set(current, login);
      this.emit("connect", this.status_of(current));
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(hello_timer);
      if (connection === null) return;
      connection.closed(`The agent on ${host} disconnected.`);
      if (this.logins.get(connection) === "token") this.tokens?.seen?.(host);
      if (this.connections.get(host) !== connection) return;
      this.connections.delete(host);
      this.emit("disconnect", host);
    });
  }

  private proves_key(host: string, nonce: string, signature: unknown): boolean {
    const declared = this.agent_keys.get(host);
    return declared !== undefined && typeof signature === "string" && verify_challenge(declared.key, this.app.name, host, nonce, signature);
  }

  disconnect(host: string, code = 1000, reason = "The server hung up."): void {
    this.connections.get(host)?.close(code, reason);
  }

  close(): void {
    for (const host of this.connections.keys()) this.disconnect(host, 1001, "The server is stopping.");
  }

  is_connected(host: string): boolean {
    return this.local?.host === host || this.connections.get(host)?.is_open === true;
  }

  status(host: string): AgentStatus | null {
    if (this.local?.host === host) return local_status(host);
    const connection = this.connections.get(host);
    return connection?.is_open ? this.status_of(connection) : null;
  }

  // The built-in agent, then every connected one.
  statuses(): AgentStatus[] {
    const remote = [...this.connections.values()].filter((connection) => connection.is_open).map((connection) => this.status_of(connection));
    return this.local === null ? remote : [local_status(this.local.host), ...remote];
  }

  // The host's agent, or null when it is not connected.
  agent(host: string): Agent<Task> | null {
    if (this.local?.host === host) return this.local.agent;
    const connection = this.connections.get(host);
    return connection?.is_open ? connection : null;
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  // A run on a host with no agent answers with exit code -1 rather than rejecting, as a command that failed does.
  run(host: string, task: Task, options: AgentRunOptions): Promise<RunResult> {
    const agent = this.agent(host);
    return agent === null ? Promise.resolve({ exit_code: -1, stdout: "", stderr: not_connected(host) }) : agent.run(task, options);
  }

  stream(host: string, task: Task, options: AgentStreamOptions = {}): CommandStream {
    return this.agent(host)?.stream(task, options) ?? ended_stream(not_connected(host));
  }

  start(host: string, run_id: string, task: Task, options: AgentStreamOptions = {}): Promise<LongRun> {
    return this.require(host).then((agent) => agent.start(run_id, task, options));
  }

  poll(host: string, run_id: string, offset: number): Promise<LongRunPoll> {
    return this.require(host).then((agent) => agent.poll(run_id, offset));
  }

  attach(host: string, run_id: string, offset: number): CommandStream {
    return this.agent(host)?.attach(run_id, offset) ?? ended_stream(not_connected(host));
  }

  stop(host: string, run_id: string): Promise<LongRun> {
    return this.require(host).then((agent) => agent.stop(run_id));
  }

  forget(host: string, run_id: string): Promise<void> {
    return this.require(host).then((agent) => agent.forget(run_id));
  }

  runs(host: string): Promise<LongRun[]> {
    return this.require(host).then((agent) => agent.runs());
  }

  request(host: string, type: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.require(host).then((agent) => agent.request(type, body));
  }

  private async require(host: string): Promise<Agent<Task>> {
    const agent = this.agent(host);
    if (agent === null) throw new AgentError(not_connected(host), true);
    return agent;
  }

  private status_of(connection: AgentConnection<Task>): AgentStatus {
    return {
      host: connection.host,
      reported_host: connection.hello.host,
      agent_version: connection.hello.agent_version,
      connected_epoch: connection.connected_epoch,
      built_in: false,
      login: this.logins.get(connection) ?? null,
      runs: connection.hello.runs,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function not_connected(host: string): string {
  return `No agent is connected for ${host}.`;
}

function local_status(host: string): AgentStatus {
  return { host, reported_host: host, agent_version: "built in", connected_epoch: 0, built_in: true, login: null, runs: [] };
}

function as_buffer(raw: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}
