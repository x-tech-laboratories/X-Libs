import { describe, expect, it } from "vitest";
import { check_url } from "../../src/agent/client.ts";
import {
  clip_hello, clip_text, decode_chunk, encode_chunk, encode_message, is_agent_message, is_run_id, is_server_message, key_host_header, most_runs_in_hello,
  parse_agent_message, parse_long_run, parse_long_run_poll, parse_long_runs, parse_run_result, parse_server_message, shell_app, unknown_run_message,
  type AgentApp, type AgentMessage, type LongRun, type ServerMessage,
} from "../../src/agent/protocol.ts";

const app = shell_app("x-test");

// An app whose tasks are typed operations, sent in an `operation` field.
interface Operation {
  kind: "probe" | "switch";
}

const typed_app: AgentApp<Operation> = {
  name: "x-typed",
  protocol_version: 2,
  task_field: "operation",
  is_task: (value): value is Operation => typeof value === "object" && value !== null && ["probe", "switch"].includes((value as Operation).kind),
};

const server_messages: ServerMessage<string>[] = [
  { type: "run", id: "r1", task: "echo hi", stdin: null, timeout_in_seconds: 5 },
  { type: "start", id: "r2", run_id: "backup-1", task: "sleep 1", stdin: "passphrase\n" },
  { type: "poll", id: "r3", run_id: "backup-1", offset: 10 },
  { type: "stop", id: "r4", run_id: "backup-1" },
  { type: "forget", id: "r5", run_id: "backup-1" },
  { type: "runs", id: "r6" },
  { type: "stream", id: "s8", task: "cat big", stdin: null, window: 1024 },
  { type: "attach", id: "s9", run_id: "backup-1", offset: 0, window: 1024 },
  { type: "credit", id: "s8", bytes: 512 },
  { type: "cancel", id: "s8" },
  { type: "ping", epoch_ms: 1 },
  { type: "pong", epoch_ms: 1 },
  { type: "challenge", nonce: "abc" },
];

const agent_messages: AgentMessage[] = [
  {
    type: "hello", protocol: 1, host: "odin", agent_version: "0.1.0",
    runs: [{ run_id: "backup-1", pid: 42, started_epoch: 1, state: "running", exit_code: null }],
  },
  { type: "reply", id: "r1", value: { exit_code: 0, stdout: "hi", stderr: "" } },
  { type: "reply", id: "r5", value: null },
  { type: "failed", id: "r2", error: "A run named 'backup-1' already exists." },
  { type: "stream_end", id: "s8", exit_code: 0, stderr: "" },
  { type: "ping", epoch_ms: 2 },
  { type: "pong", epoch_ms: 2 },
];

describe("agent protocol", () => {
  it("reads back every server message it writes", () => {
    for (const message of server_messages) {
      const parsed = parse_server_message(encode_message(message, app), app);
      expect(parsed).toEqual(message);
      expect(is_server_message(parsed!)).toBe(true);
    }
  });

  it("reads back every agent message it writes", () => {
    for (const message of agent_messages) {
      const parsed = parse_agent_message(encode_message(message, app), app);
      expect(parsed).toEqual(message);
      expect(is_agent_message(parsed!)).toBe(true);
    }
  });

  it("refuses text that is not a message, or a known message missing a field", () => {
    expect(parse_server_message("not json", app)).toBeNull();
    expect(parse_server_message("[]", app)).toBeNull();
    expect(parse_server_message(JSON.stringify({ id: "r1" }), app)).toBeNull();
    expect(parse_server_message(JSON.stringify({ type: "run", id: "r1", command: "ls" }), app)).toBeNull();
    expect(parse_server_message(JSON.stringify({ type: "poll", id: "r1", run_id: "x", offset: "0" }), app)).toBeNull();
    expect(parse_agent_message(JSON.stringify({ type: "reply", id: "r1" }), app)).toBeNull();
    expect(parse_agent_message(JSON.stringify({ type: "hello", protocol: 1, host: "odin", agent_version: "1" }), app)).toBeNull();
  });

  it("hands over a message of the app's own as it is", () => {
    const server = parse_server_message(JSON.stringify({ type: "health", id: "r7" }), app)!;
    const agent = parse_agent_message(JSON.stringify({ type: "pulls", pulls: [1] }), app)!;

    expect(server).toEqual({ type: "health", id: "r7" });
    expect(is_server_message(server)).toBe(false);
    expect(agent).toEqual({ type: "pulls", pulls: [1] });
    expect(is_agent_message(agent)).toBe(false);
  });

  it("sends a task in the app's own field and checks it with the app's test", () => {
    const run: ServerMessage<Operation> = { type: "run", id: "r1", task: { kind: "probe" }, stdin: null, timeout_in_seconds: 5 };

    const text = encode_message(run, typed_app);

    expect(JSON.parse(text)).toEqual({ type: "run", id: "r1", operation: { kind: "probe" }, stdin: null, timeout_in_seconds: 5 });
    expect(parse_server_message(text, typed_app)).toEqual(run);
    expect(parse_server_message(JSON.stringify({ type: "run", id: "r1", operation: { kind: "format" }, stdin: null, timeout_in_seconds: 5 }), typed_app)).toBeNull();
    expect(parse_server_message(JSON.stringify({ type: "run", id: "r1", command: "ls", stdin: null, timeout_in_seconds: 5 }), typed_app)).toBeNull();
    expect(JSON.parse(encode_message(server_messages[0], app))).toMatchObject({ command: "echo hi" });
  });

  it("tags a binary output frame with its stream id", () => {
    const data = Buffer.from([0, 1, 2, 255]);
    expect(decode_chunk(encode_chunk("s12", data))).toEqual({ id: "s12", data });
    expect(decode_chunk(encode_chunk("s1", Buffer.alloc(0)))).toEqual({ id: "s1", data: Buffer.alloc(0) });
    expect(decode_chunk(new Uint8Array([5, 1]))).toBeNull();
  });

  it("keeps run ids to names safe for a folder", () => {
    expect(is_run_id("backup-odin.2026_10_29")).toBe(true);
    for (const bad of ["", ".", "..", "../etc", "a/b", "a b", "x".repeat(129)]) expect(is_run_id(bad)).toBe(false);
  });

  it("names the key login's header after the app", () => {
    expect(key_host_header("x-nix")).toBe("x-nix-agent-host");
  });
});

describe("agent URL", () => {
  it("takes wss:// anywhere and ws:// only to this machine", () => {
    expect(check_url("wss://server.example.org/api/agent").host).toBe("server.example.org");
    for (const local of ["ws://localhost:7710/api/agent", "ws://127.0.0.1:7710/api/agent", "ws://[::1]:7710/api/agent"]) {
      expect(check_url(local).protocol).toBe("ws:");
    }
    expect(() => check_url("ws://server.example.org/api/agent")).toThrow(/only allowed to this machine/);
    expect(() => check_url("https://server.example.org/api/agent")).toThrow(/must start with wss/);
    expect(() => check_url("server")).toThrow(/not a URL/);
  });
});

describe("checking what an agent sends", () => {
  const run: LongRun = { run_id: "backup-1", pid: 42, started_epoch: 1700000000, state: "exited", exit_code: 0 };

  it("keeps a long run's own fields and refuses a malformed one", () => {
    expect(parse_long_run({ ...run, extra: "dropped" })).toEqual(run);
    for (const broken of [null, [], "run", { ...run, run_id: "../x" }, { ...run, pid: 1.5 }, { ...run, started_epoch: "now" }, { ...run, state: "gone" }, { ...run, exit_code: 0.5 }]) {
      expect(parse_long_run(broken)).toBeNull();
    }
  });

  it("keeps the well-formed runs of a list, the last ones up to a limit", () => {
    expect(parse_long_runs("runs", 10)).toBeNull();
    expect(parse_long_runs([run, { run_id: "x" }, { ...run, run_id: "second" }], 10)).toEqual([run, { ...run, run_id: "second" }]);
    expect(parse_long_runs([run, { ...run, run_id: "second" }], 1)).toEqual([{ ...run, run_id: "second" }]);
  });

  it("refuses a poll reply whose offsets are not counts within its size", () => {
    const poll = { state: "running", exit_code: null, alive: true, size: 10, new_output: "abc", next_offset: 3 };
    expect(parse_long_run_poll({ ...poll, extra: 1 })).toEqual(poll);
    for (const broken of [{ ...poll, size: -1 }, { ...poll, next_offset: 11 }, { ...poll, size: Number.MAX_SAFE_INTEGER + 2 }, { ...poll, alive: 1 }, "poll"]) {
      expect(parse_long_run_poll(broken)).toBeNull();
    }
  });

  it("refuses a run reply that is not a result", () => {
    expect(parse_run_result({ exit_code: 0, stdout: "a", stderr: "", extra: 1 })).toEqual({ exit_code: 0, stdout: "a", stderr: "" });
    expect(parse_run_result({ exit_code: 0, stdout: 1, stderr: "" })).toBeNull();
    expect(parse_run_result(null)).toBeNull();
  });

  it("cuts a hello's texts and runs to their limits", () => {
    const hello = clip_hello({ type: "hello", protocol: 1, host: "h".repeat(1000), agent_version: "1", runs: Array.from({ length: most_runs_in_hello + 1 }, () => run), signature: "s" });
    expect(hello.host.length).toBe(256);
    expect(hello.runs.length).toBe(most_runs_in_hello);
    expect(hello.signature).toBe("s");
    expect(clip_text("short", 10)).toBe("short");
  });

  it("names a run the agent does not know in the words the server recognises", () => {
    expect(unknown_run_message("backup-1")).toBe("No run named 'backup-1'.");
  });
});
