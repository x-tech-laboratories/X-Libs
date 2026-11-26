import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyObject } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agent_hello_text, fingerprint_of, new_nonce, parse_private_key, parse_public_key, parse_server_keys, server_challenge_text, server_message_text, sign_text, verify_text,
} from "../../src/agent/keys.ts";
import { LongRuns } from "../../src/agent/long_runs.ts";
import { encode_message, encode_signed_message, parse_signed_message, shell_app } from "../../src/agent/protocol.ts";
import { AgentSession, server_refused_close_code, type MessageSocket } from "../../src/agent/session.ts";
import { shell_runner } from "../../src/agent/tasks.ts";
import { make_key } from "../test_keys.ts";

const app = shell_app("x-test");
const runner = shell_runner("x-test-run");

// A socket that keeps what the session sends and how it was closed.
class FakeSocket implements MessageSocket {
  readyState = 1;
  readonly sent: string[] = [];
  close_code: number | null = null;

  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (typeof data === "string") this.sent.push(data);
  }

  close(code?: number): void {
    this.close_code = code ?? 1000;
    this.readyState = 3;
  }

  messages(): Record<string, unknown>[] {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }
}

let folder: string;
let server_key: KeyObject;
let server_line: string;
let agent_key: KeyObject;
let agent_public: KeyObject;
let other_server_key: KeyObject;

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "x-libs-session-"));
  const server = make_key(folder, "server");
  server_key = parse_private_key(readFileSync(server.private_file, "utf8"));
  server_line = server.public_line;
  const agent = make_key(folder, "agent");
  agent_key = parse_private_key(readFileSync(agent.private_file, "utf8"));
  agent_public = parse_public_key(agent.public_line);
  other_server_key = parse_private_key(readFileSync(make_key(folder, "other-server").private_file, "utf8"));
});

let socket: FakeSocket;
let session: AgentSession<string>;
let logged: string[];

function start_session(options: { server_lines?: string[]; key?: KeyObject | null; challenge_timeout_in_milliseconds?: number } = {}): AgentSession<string> {
  const runs = new LongRuns(mkdtempSync(join(folder, "runs-")), runner);
  socket = new FakeSocket();
  logged = [];
  session = new AgentSession(socket, runs, {
    app, runner, host: "odin", agent_version: "test", heartbeat_in_milliseconds: 60_000,
    key: options.key === undefined ? agent_key : options.key,
    server_keys: parse_server_keys(options.server_lines ?? [server_line]),
    challenge_timeout_in_milliseconds: options.challenge_timeout_in_milliseconds,
    log: (line) => logged.push(line),
  });
  return session;
}

function signed_challenge(nonce: string, key = server_key, host = "odin"): string {
  const fingerprint = fingerprint_of(key);
  return encode_message({ type: "challenge", nonce, server_key: fingerprint, server_signature: sign_text(key, server_challenge_text(app.name, host, nonce, fingerprint)) }, app);
}

// Logs the session in with a signed challenge and gives the nonces of its connection.
function log_in(): { server_nonce: string; agent_nonce: string } {
  const server_nonce = new_nonce();
  session.receive(signed_challenge(server_nonce));
  const hello = socket.messages()[0];
  return { server_nonce, agent_nonce: hello.agent_nonce as string };
}

function seal(text: string, counter: number, nonces: { server_nonce: string; agent_nonce: string }, key = server_key): string {
  return encode_signed_message(text, counter, sign_text(key, server_message_text(app.name, "odin", nonces.server_nonce, nonces.agent_nonce, counter, text)));
}

function run_text(id: string, command: string, stdin: string | null = null): string {
  return encode_message({ type: "run", id, task: command, stdin, timeout_in_seconds: 5 }, app);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reply_to(id: string): Promise<Record<string, unknown>> {
  for (;;) {
    const found = socket.messages().find((message) => message.id === id);
    if (found !== undefined) return found;
    await sleep(10);
  }
}

beforeEach(() => start_session());

afterEach(() => session.close());

describe("an agent that checks the server", () => {
  it("signs a hello bound to both nonces and the server's key only once the challenge checks out", async () => {
    const nonces = log_in();
    const hello = socket.messages()[0];

    expect(hello).toMatchObject({ type: "hello", host: "odin", agent_nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(verify_text(agent_public, agent_hello_text(app.name, "odin", nonces.server_nonce, nonces.agent_nonce, fingerprint_of(server_key)), hello.signature)).toBe(true);

    session.receive(seal(run_text("r1", "cat", "secret"), 1, nonces));
    session.receive(seal(encode_message({ type: "ping", epoch_ms: 5 }, app), 2, nonces));

    expect(await reply_to("r1")).toMatchObject({ type: "reply", value: { exit_code: 0, stdout: "secret" } });
    expect(socket.messages()).toContainEqual({ type: "pong", epoch_ms: 5 });
    expect(socket.close_code).toBeNull();
  });

  it("answers no challenge from a server without its key, and signs nothing", () => {
    for (const challenge of [
      encode_message({ type: "challenge", nonce: new_nonce() }, app),
      signed_challenge(new_nonce(), other_server_key),
      signed_challenge(new_nonce(), server_key, "thor"),
      encode_message({ type: "challenge", nonce: new_nonce(), server_key: fingerprint_of(server_key), server_signature: "AAAA" }, app),
    ]) {
      start_session();
      session.receive(challenge);

      expect(socket.sent).toEqual([]);
      expect(socket.close_code).toBe(server_refused_close_code);
      expect(logged.join("\n")).toMatch(/Refused the server/);
    }
    expect(logged[0]).toMatch(/is not signed by its key/);
  });

  it("says why it refuses a server that signs nothing, or with a key it does not list", () => {
    session.receive(encode_message({ type: "challenge", nonce: new_nonce() }, app));
    expect(logged[0]).toMatch(/did not sign its challenge/);

    start_session();
    session.receive(signed_challenge(new_nonce(), other_server_key));
    expect(logged[0]).toMatch(/not one of this agent's server keys/);
  });

  it("refuses a request that comes before the signed challenge, with a failure for it", () => {
    session.receive(run_text("r1", "touch /tmp/never"));

    expect(socket.messages()).toEqual([{ type: "failed", id: "r1", error: expect.stringMatching(/before its signed challenge/) }]);
    expect(socket.close_code).toBe(server_refused_close_code);
  });

  it("hangs up when no signed challenge comes in time", async () => {
    start_session({ challenge_timeout_in_milliseconds: 20 });
    await sleep(60);

    expect(socket.sent).toEqual([]);
    expect(socket.close_code).toBe(server_refused_close_code);
    expect(logged[0]).toMatch(/No signed challenge came/);
  });

  it("refuses an unsigned request once logged in, answers it with a failure and hangs up", () => {
    log_in();
    session.receive(run_text("r1", "echo hi"));

    expect(socket.messages()[1]).toMatchObject({ type: "failed", id: "r1", error: expect.stringMatching(/did not sign/) });
    expect(socket.close_code).toBe(server_refused_close_code);
    session.receive(run_text("r2", "echo hi"));
    expect(socket.sent).toHaveLength(2);
  });

  it("refuses a tampered message, even one changing only its stdin", () => {
    const nonces = log_in();
    const sealed = JSON.parse(seal(run_text("r1", "cat", "secret"), 1, nonces)) as Record<string, unknown>;
    sealed.message = run_text("r1", "cat", "other secret");

    session.receive(JSON.stringify(sealed));

    expect(socket.messages()[1]).toMatchObject({ type: "failed", id: "r1", error: expect.stringMatching(/not signed by its key/) });
    expect(socket.close_code).toBe(server_refused_close_code);
  });

  it("refuses a replayed message", async () => {
    const nonces = log_in();
    const sealed = seal(run_text("r1", "echo once"), 1, nonces);
    session.receive(sealed);
    await reply_to("r1");

    session.receive(sealed);

    expect(socket.messages().at(-1)).toMatchObject({ type: "failed", id: "r1", error: expect.stringMatching(/went from 1 to 1/) });
    expect(socket.close_code).toBe(server_refused_close_code);
  });

  it("refuses a message whose counter skips or goes back", () => {
    const nonces = log_in();
    session.receive(seal(run_text("r2", "echo later"), 2, nonces));

    expect(socket.messages()[1]).toMatchObject({ type: "failed", id: "r2", error: expect.stringMatching(/went from 0 to 2/) });
    expect(socket.close_code).toBe(server_refused_close_code);
  });

  it("refuses a message signed for another connection", () => {
    const nonces = log_in();
    const other_connection = { server_nonce: nonces.server_nonce, agent_nonce: new_nonce() };

    session.receive(seal(run_text("r1", "echo hi"), 1, other_connection));

    expect(socket.messages()[1]).toMatchObject({ type: "failed", id: "r1" });
    expect(socket.close_code).toBe(server_refused_close_code);
  });

  it("refuses a message signed with another key, or a signed frame with a malformed counter", () => {
    let nonces = log_in();
    session.receive(seal(run_text("r1", "echo hi"), 1, nonces, other_server_key));
    expect(socket.close_code).toBe(server_refused_close_code);

    start_session();
    nonces = log_in();
    const sealed = JSON.parse(seal(run_text("r1", "echo hi"), 1, nonces)) as Record<string, unknown>;
    session.receive(JSON.stringify({ ...sealed, counter: "1" }));
    expect(socket.messages()[1]).toMatchObject({ type: "failed", id: "r1" });
    expect(socket.close_code).toBe(server_refused_close_code);
  });

  it("accepts any of its listed server keys, as while the server's key is being replaced", () => {
    const other_line = make_key(folder, "next-server").public_line;
    start_session({ server_lines: [other_line, server_line] });

    log_in();

    expect(socket.messages()[0]).toMatchObject({ type: "hello" });
    expect(socket.close_code).toBeNull();
  });

  it("logs in without a key of its own, as with a token, still binding the server's nonce", () => {
    start_session({ key: null });
    const nonces = log_in();

    expect(socket.messages()[0]).toMatchObject({ type: "hello", agent_nonce: nonces.agent_nonce });
    expect(socket.messages()[0].signature).toBeUndefined();
  });

  it("checks the signed frame's text as it arrived, with no re-encoding", () => {
    const nonces = log_in();
    const text = `{ "id" : "r1", "type":"run", "command":"echo spaced", "stdin":null, "timeout_in_seconds":5 }`;

    session.receive(seal(text, 1, nonces));

    expect(parse_signed_message(seal(text, 1, nonces))?.message).toBe(text);
    expect(socket.close_code).toBeNull();
  });
});
