import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { allow_tool, deny_tool, start_claude_stream, user_message_line, type StreamMessage } from "../../src/agent/claude_stream.ts";

const stand_in = join(import.meta.dirname, "..", "fixtures", "fake_claude_stream.mjs");

// Waits until the lines seen so far hold one the test is looking for.
async function until(seen: StreamMessage[], found: (message: StreamMessage) => boolean): Promise<StreamMessage> {
  for (let tries = 0; tries < 200; tries += 1) {
    const match = seen.find(found);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the stand-in never said it");
}

const text_of = (message: StreamMessage) => (((message.message as StreamMessage | undefined)?.content as StreamMessage[] | undefined)?.[0]?.text as string | undefined) ?? "";

describe("a session over stream-json", () => {
  it("writes user messages, hands on every line it prints and ends once its input closes", async () => {
    const seen: StreamMessage[] = [];
    const raw: string[] = [];
    const stream = start_claude_stream(["node", stand_in], { on_line: (line, message) => (raw.push(line), message && seen.push(message)) });

    stream.send_user("hello", "id-1");
    await until(seen, (message) => text_of(message) === "heard hello");
    stream.end_input();
    const exit = await stream.finished;

    expect(exit.exit_code).toBe(0);
    expect(stream.is_open()).toBe(false);
    expect(raw).toContain("not json");
    expect(seen.find((message) => message.uuid === "id-1")).toMatchObject({ isReplay: true });
    expect(seen.at(-1)).toMatchObject({ type: "result", result: "done" });
  });

  it("settles control requests with the session's answer or its refusal", async () => {
    const stream = start_claude_stream(["node", stand_in], { on_line: () => undefined });

    await expect(stream.control({ subtype: "set_permission_mode", mode: "acceptEdits" })).resolves.toEqual({ mode: "acceptEdits" });
    await expect(stream.control({ subtype: "interrupt" })).resolves.toEqual({});
    await expect(stream.control({ subtype: "rewind" })).rejects.toThrow("no rewind");
    stream.end_input();
    await stream.finished;
    await expect(stream.control({ subtype: "interrupt" })).rejects.toThrow("no longer taking requests");
  });

  it("gives up on a control request the session never answers, and on one left open when it ends", async () => {
    const stream = start_claude_stream(["node", stand_in], { on_line: () => undefined, control_timeout_in_milliseconds: 50 });

    await expect(stream.control({ subtype: "never_answer" })).rejects.toThrow("did not answer in time");
    const left_open = stream.control({ subtype: "never_answer" });
    stream.end_input();

    await expect(left_open).rejects.toThrow(/ended before it answered|did not answer in time/);
  });

  it("passes the session's own requests on to be answered, and refuses those not taken", async () => {
    const seen: StreamMessage[] = [];
    const requests: [string, StreamMessage][] = [];
    const stream = start_claude_stream(["node", stand_in], {
      on_line: (_line, message) => message && seen.push(message),
      on_request: (request_id, request) => (request.subtype === "can_use_tool" ? (requests.push([request_id, request]), true) : false),
    });

    stream.send_user("ask", "id-2");
    await until(seen, (message) => message.uuid === "id-2");
    for (let tries = 0; tries < 200 && requests.length === 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    stream.respond(requests[0]![0], allow_tool({ command: "ls -l" }));
    const allowed = await until(seen, (message) => text_of(message).startsWith("success perm_1"));
    stream.send_user("unknown request", "id-3");
    const refused = await until(seen, (message) => text_of(message).startsWith("error other_1"));
    stream.end_input();
    await stream.finished;

    expect(requests[0]![1]).toMatchObject({ subtype: "can_use_tool", tool_name: "Bash" });
    expect(text_of(allowed)).toContain('"behavior":"allow"');
    expect(text_of(refused)).toContain("does not answer this request");
  });
});

describe("the lines written to a session", () => {
  it("are a user message with its id and allow or deny answers", () => {
    expect(JSON.parse(user_message_line("hi", "u1"))).toEqual({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] }, parent_tool_use_id: null, uuid: "u1" });
    expect(allow_tool({ command: "ls" })).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
    expect(deny_tool("")).toEqual({ behavior: "deny", message: "The user refused this tool call." });
    expect(deny_tool("not now")).toEqual({ behavior: "deny", message: "not now" });
  });
});
