// One connection to the server: says hello, with its signature of the server's challenge when it logs in with a key,
// answers each request, and sends streamed output only as far as the server's credit allows. Closing it stops the
// streams it was sending; long runs carry on. Given the server keys it accepts, it checks the server's signed challenge
// before it says anything, and then takes only messages the server signed for this connection, in order, refusing and
// hanging up on any other.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { KeyObject } from "node:crypto";

import type { CommandStream } from "./commands.ts";
import { agent_hello_text, new_nonce, server_challenge_text, server_message_text, sign_challenge, sign_text, verify_text } from "./keys.ts";
import type { LongRuns } from "./long_runs.ts";
import {
  encode_chunk, encode_message, is_server_message, most_runs_in_hello, parse_server_message, parse_signed_message,
  type AgentApp, type AgentMessage, type AppMessage, type RequestMessage, type ServerMessage,
} from "./protocol.ts";
import type { TaskRunner } from "./tasks.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

// The app's own requests by type, each answered with what its handler returns.
export type AppRequests = Record<string, (message: AppMessage) => unknown>;

export interface SessionHooks<Task> {
  requests?: AppRequests;
  // Takes an app message from the server that is not a request.
  on_message?: (message: AppMessage, session: AgentSession<Task>) => void;
  // Runs once the hello has gone, as for an app that reports what it did while the server was away.
  on_hello?: (session: AgentSession<Task>) => void;
}

export interface SessionOptions<Task> extends SessionHooks<Task> {
  app: AgentApp<Task>;
  runner: TaskRunner<Task>;
  host: string;
  agent_version: string;
  // A ping goes out this often, and a server silent for three of them is taken as gone.
  heartbeat_in_milliseconds: number;
  // The host's private key, when it logs in with one rather than a token.
  key?: KeyObject | null;
  // The server keys the agent accepts by fingerprint, as `parse_server_keys` reads them, which the server must sign its challenge and every message with.
  server_keys?: ReadonlyMap<string, KeyObject>;
  // How long an agent that checks the server waits for its signed challenge.
  challenge_timeout_in_milliseconds?: number;
  log?: (line: string) => void;
}

// The close code an agent hangs up with when the server's challenge or a message is not signed as it must be.
export const server_refused_close_code = 4009;

// What a session that checks the server knows of its connection once the challenge checked out.
interface SignedConnection {
  server_nonce: string;
  agent_nonce: string;
  server_key: KeyObject;
  last_counter: number;
}

// The smallest message a socket can send, so a test can stand in for one.
export interface MessageSocket {
  readonly readyState: number;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
}

const socket_open = 1;

// ── Output ───────────────────────────────────────────────────────────────────

// Sends a stream's stdout as binary frames within the credit granted, then its end once all of it has gone.
class OutputPump {
  private readonly id: string;
  private readonly stream: CommandStream;
  private readonly session: AgentSession<unknown>;
  private credit: number;
  private readonly pending: Buffer[] = [];
  private stdout_ended = false;
  private result: { exit_code: number; stderr: string } | null = null;
  private finished = false;

  constructor(id: string, stream: CommandStream, window: number, session: AgentSession<unknown>) {
    this.id = id;
    this.stream = stream;
    this.credit = window;
    this.session = session;
    stream.stdout.on("data", (chunk: Buffer) => {
      this.pending.push(chunk);
      this.flush();
    });
    stream.stdout.on("error", () => {});
    stream.stdout.on("close", () => {
      this.stdout_ended = true;
      this.finish_when_done();
    });
    void stream.done.then((result) => {
      this.result = result;
      this.finish_when_done();
    });
  }

  grant(bytes: number): void {
    this.credit += Math.max(0, bytes);
    this.flush();
  }

  // Stops the command and drops what it had yet to send.
  cancel(): void {
    this.pending.length = 0;
    this.stream.stop();
    this.stream.stdout.resume();
  }

  private flush(): void {
    while (this.credit > 0 && this.pending.length > 0) {
      const chunk = this.pending[0];
      const piece = chunk.length > this.credit ? chunk.subarray(0, this.credit) : chunk;
      if (piece === chunk) this.pending.shift();
      else this.pending[0] = chunk.subarray(piece.length);
      this.credit -= piece.length;
      this.session.send_chunk(this.id, piece);
    }
    if (this.pending.length > 0) this.stream.stdout.pause();
    else if (!this.stdout_ended) this.stream.stdout.resume();
    this.finish_when_done();
  }

  private finish_when_done(): void {
    if (this.finished || !this.stdout_ended || this.result === null || this.pending.length > 0) return;
    this.finished = true;
    this.session.end_stream(this.id, this.result);
  }
}

// ── Session ──────────────────────────────────────────────────────────────────

export class AgentSession<Task> {
  private readonly socket: MessageSocket;
  private readonly runs: LongRuns<Task>;
  private readonly options: SessionOptions<Task>;
  private readonly pumps = new Map<string, OutputPump>();
  private last_heard = Date.now();
  private readonly heartbeat: NodeJS.Timeout;
  private closed = false;
  private greeted = false;
  private readonly checks_server: boolean;
  private signed: SignedConnection | null = null;
  private challenge_timer: NodeJS.Timeout | undefined;

  constructor(socket: MessageSocket, runs: LongRuns<Task>, options: SessionOptions<Task>) {
    this.socket = socket;
    this.runs = runs;
    this.options = options;
    this.heartbeat = setInterval(() => this.beat(), options.heartbeat_in_milliseconds);
    this.heartbeat.unref();
    this.checks_server = (options.server_keys?.size ?? 0) > 0;
    if (this.checks_server) {
      const timeout = options.challenge_timeout_in_milliseconds ?? 10_000;
      this.challenge_timer = setTimeout(() => this.refuse("No signed challenge came from the server; it may hold no server key, so this agent will not answer it.", null), timeout);
      this.challenge_timer.unref();
    } else if (!options.key) {
      this.say_hello();
    }
  }

  private say_hello(signature?: string, agent_nonce?: string): void {
    this.greeted = true;
    const hello = { type: "hello", protocol: this.options.app.protocol_version, host: this.options.host, agent_version: this.options.agent_version, runs: this.runs.list().slice(-most_runs_in_hello) } as const;
    this.send({ ...hello, ...(signature === undefined ? {} : { signature }), ...(agent_nonce === undefined ? {} : { agent_nonce }) });
    this.options.on_hello?.(this);
  }

  // Handles one text frame from the server; anything that is not a message is ignored, unless the agent checks the server.
  receive(text: string): void {
    if (this.closed) return;
    this.last_heard = Date.now();
    if (!this.checks_server) {
      this.dispatch(text);
      return;
    }
    if (this.signed === null) {
      this.receive_challenge(text);
      return;
    }
    const opened = this.open_signed(this.signed, text);
    if (opened.error !== null) this.refuse(opened.error, text);
    else this.dispatch(opened.text);
  }

  // The connection has gone: stops the streams that were being sent, since nobody reads them now.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.challenge_timer);
    for (const pump of this.pumps.values()) pump.cancel();
    this.pumps.clear();
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  send(message: AgentMessage | AppMessage): void {
    if (!this.closed && this.socket.readyState === socket_open) this.socket.send(encode_message(message, this.options.app));
  }

  send_chunk(id: string, data: Buffer): void {
    if (!this.closed && this.socket.readyState === socket_open) this.socket.send(encode_chunk(id, data));
  }

  end_stream(id: string, result: { exit_code: number; stderr: string }): void {
    this.pumps.delete(id);
    this.send({ type: "stream_end", id, exit_code: result.exit_code, stderr: result.stderr });
  }

  // ── Checking the server ──────────────────────────────────────────────────

  // Checks the server's signature of its challenge before signing anything, then says hello with a nonce of its own.
  private receive_challenge(text: string): void {
    const message = parse_server_message(text, this.options.app);
    if (message === null || message.type !== "challenge" || !is_server_message(message)) {
      this.refuse("The server sent a message before its signed challenge.", text);
      return;
    }
    const challenge = message as Extract<ServerMessage<Task>, { type: "challenge" }>;
    const { app, host, server_keys } = this.options;
    if (typeof challenge.server_key !== "string" || typeof challenge.server_signature !== "string") {
      this.refuse("The server did not sign its challenge, and this agent answers only a server that signs with one of its server keys.", null);
      return;
    }
    const server_key = server_keys!.get(challenge.server_key);
    if (server_key === undefined) {
      this.refuse(`The server signed with the key ${clip(challenge.server_key)}, which is not one of this agent's server keys.`, null);
      return;
    }
    if (!verify_text(server_key, server_challenge_text(app.name, host, challenge.nonce, challenge.server_key), challenge.server_signature)) {
      this.refuse(`The server's challenge for ${host} is not signed by its key ${challenge.server_key}.`, null);
      return;
    }
    clearTimeout(this.challenge_timer);
    const agent_nonce = new_nonce();
    this.signed = { server_nonce: challenge.nonce, agent_nonce, server_key, last_counter: 0 };
    const key = this.options.key;
    const signature = key ? sign_text(key, agent_hello_text(app.name, host, challenge.nonce, agent_nonce, challenge.server_key)) : undefined;
    this.say_hello(signature, agent_nonce);
  }

  // The text of a signed message whose counter follows the last and whose signature checks out, or why it does not.
  private open_signed(signed: SignedConnection, text: string): { text: string; error: null } | { text: null; error: string } {
    const envelope = parse_signed_message(text);
    if (envelope === null) return { text: null, error: "The server sent a message it did not sign." };
    if (envelope.counter !== signed.last_counter + 1) {
      return { text: null, error: `The server's message counter went from ${signed.last_counter} to ${envelope.counter}, so a message was replayed, reordered or dropped.` };
    }
    const signed_text = server_message_text(this.options.app.name, this.options.host, signed.server_nonce, signed.agent_nonce, envelope.counter, envelope.message);
    if (!verify_text(signed.server_key, signed_text, envelope.signature)) return { text: null, error: "The server's message is not signed by its key for this connection." };
    signed.last_counter = envelope.counter;
    return { text: envelope.message, error: null };
  }

  // Answers a refused message that carries an id with a failure, logs why, and hangs up.
  private refuse(reason: string, text: string | null): void {
    if (this.closed) return;
    const id = text === null ? null : request_id_of(text);
    if (id !== null) this.send({ type: "failed", id, error: `The agent refused the request: ${reason}` });
    (this.options.log ?? console.error)(`Refused the server: ${reason}`);
    this.socket.close(server_refused_close_code, "The server's signature did not check out.");
    this.close();
  }

  // ── Handling ─────────────────────────────────────────────────────────────

  // Handles one message's text once it is known to come from the server.
  private dispatch(text: string): void {
    const message = parse_server_message(text, this.options.app);
    if (message === null) return;
    if (is_server_message(message)) this.handle(message);
    else this.handle_app(message);
  }

  private handle(message: ServerMessage<Task>): void {
    switch (message.type) {
      case "ping":
        this.send({ type: "pong", epoch_ms: message.epoch_ms });
        return;
      case "pong":
        return;
      case "challenge":
        if (this.options.key && !this.greeted) this.say_hello(sign_challenge(this.options.key, this.options.app.name, this.options.host, message.nonce));
        return;
      case "credit":
        this.pumps.get(message.id)?.grant(message.bytes);
        return;
      case "cancel":
        this.pumps.get(message.id)?.cancel();
        return;
      case "stream":
        this.start_pump(message.id, () => this.open_stream(message.task, message.stdin), message.window);
        return;
      case "attach":
        this.start_pump(message.id, () => this.runs.tail(message.run_id, message.offset), message.window);
        return;
      default:
        void this.answer(message.id, () => this.value_for(message));
    }
  }

  // A message carrying an id is a request the app answers; anything else goes to the app as it is.
  private handle_app(message: AppMessage): void {
    if (typeof message.id !== "string") {
      this.options.on_message?.(message, this);
      return;
    }
    const requests = this.options.requests ?? {};
    const handler = Object.hasOwn(requests, message.type) ? requests[message.type] : undefined;
    if (handler === undefined) {
      this.send({ type: "failed", id: message.id, error: `This agent does not know the request '${message.type}'.` });
      return;
    }
    void this.answer(message.id, () => handler(message));
  }

  private start_pump(id: string, open: () => CommandStream, window: number): void {
    if (this.pumps.has(id)) return;
    let stream: CommandStream;
    try {
      stream = open();
    } catch (error) {
      this.send({ type: "stream_end", id, exit_code: -1, stderr: (error as Error).message });
      return;
    }
    this.pumps.set(id, new OutputPump(id, stream, window, this as AgentSession<unknown>));
  }

  private async answer(id: string, work: () => unknown): Promise<void> {
    try {
      const value = await work();
      this.send({ type: "reply", id, value: value ?? null });
    } catch (error) {
      this.send({ type: "failed", id, error: (error as Error).message });
    }
  }

  private open_stream(task: Task, stdin: string | null): CommandStream {
    if (this.options.runner.stream === undefined) throw new Error("This agent does not stream its tasks.");
    return this.options.runner.stream(task, { stdin });
  }

  private async value_for(message: RequestMessage<Task>): Promise<unknown> {
    switch (message.type) {
      case "run":
        return this.options.runner.run(message.task, { timeout_in_seconds: message.timeout_in_seconds, stdin: message.stdin });
      case "start":
        return this.runs.start(message.run_id, message.task, message.stdin);
      case "poll":
        return this.runs.poll(message.run_id, message.offset);
      case "stop":
        return this.runs.stop(message.run_id);
      case "forget":
        this.runs.forget(message.run_id);
        return null;
      case "runs":
        return this.runs.list();
    }
  }

  // Pings the server, or gives up on one that has been silent for three beats.
  private beat(): void {
    if (Date.now() - this.last_heard > 3 * this.options.heartbeat_in_milliseconds) {
      this.socket.close(4008, "The server stopped answering.");
      this.close();
      return;
    }
    this.send({ type: "ping", epoch_ms: Date.now() });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// The id of the request a refused frame carries, read from the message a signed frame wraps, or null for none.
function request_id_of(text: string): string | null {
  const record_of = (value: unknown): Record<string, unknown> => {
    if (typeof value !== "string") return {};
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const outer = record_of(text);
  const id = typeof outer.message === "string" ? record_of(outer.message).id : outer.id;
  return typeof id === "string" ? clip(id) : null;
}

// A text from the server cut short enough to log or echo back.
function clip(text: string): string {
  return text.length <= 128 ? text : `${text.slice(0, 128)}…`;
}
