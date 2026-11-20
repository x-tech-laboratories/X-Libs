import { describe, expect, it } from "vitest";

import { add_permission, add_user_message, permission_rule, rule_covers, rule_words, waiting_permissions, close_open_blocks, edit_of, empty_transcript, fold_stream_message, pending_messages, read_transcript, stored_transcript, tool_summary, type ToolEntry } from "../src/agent_transcript.ts";

const event = (message_id: string, body: Record<string, unknown>) => ({ type: "stream_event", api_message_id: message_id, event: body });

describe("a transcript read from the stream", () => {
  it("builds a block from its partial pieces, then takes the whole message in its place", () => {
    const transcript = empty_transcript();

    fold_stream_message(transcript, event("m1", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    fold_stream_message(transcript, event("m1", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } }));
    fold_stream_message(transcript, event("m1", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "there" } }));
    expect(transcript.entries).toEqual([{ kind: "text", text: "Hello there", message_id: "m1", streaming: true }]);

    fold_stream_message(transcript, { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello there." }] } });
    fold_stream_message(transcript, event("m1", { type: "content_block_stop", index: 0 }));
    expect(transcript.entries).toEqual([{ kind: "text", text: "Hello there.", streaming: false }]);
  });

  it("keeps streamed thinking when the whole message carries none, and closes a block on its end", () => {
    const transcript = empty_transcript();
    fold_stream_message(transcript, event("m1", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    fold_stream_message(transcript, event("m1", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Look first." } }));
    fold_stream_message(transcript, event("m1", { type: "content_block_stop", index: 0 }));
    fold_stream_message(transcript, { type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "" }] } });

    expect(transcript.entries).toEqual([{ kind: "thinking", text: "Look first.", streaming: false }]);
  });

  it("reads a tool's input as it is written, its result, and an error", () => {
    const transcript = empty_transcript();
    fold_stream_message(transcript, event("m2", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} } }));
    fold_stream_message(transcript, event("m2", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":' } }));
    expect(transcript.entries[0]).toMatchObject({ input_text: '{"command":', streaming: true });
    fold_stream_message(transcript, event("m2", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"ls"}' } }));
    fold_stream_message(transcript, event("m2", { type: "content_block_stop", index: 1 }));
    expect(transcript.entries[0]).toEqual({ kind: "tool", id: "t1", name: "Bash", input: { command: "ls" }, message_id: "m2", streaming: false });

    fold_stream_message(transcript, { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
    fold_stream_message(transcript, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a.txt" }], is_error: true }] } });
    expect(transcript.entries[0]).toEqual({ kind: "tool", id: "t1", name: "Bash", input: { command: "ls" }, streaming: false, result: "a.txt", is_error: true });
  });

  it("takes whole messages alone when no partial pieces came, cutting long inputs", () => {
    const transcript = empty_transcript();
    fold_stream_message(transcript, { type: "assistant", message: { id: "m3", content: [{ type: "text", text: "Done." }, { type: "tool_use", id: "t2", name: "Write", input: { file_path: "a", content: "x".repeat(9000) } }] } });

    expect(transcript.entries[0]).toEqual({ kind: "text", text: "Done.", streaming: false });
    expect(String((transcript.entries[1] as ToolEntry).input.content)).toContain("1000 more characters left out");
  });

  it("marks the user's message read once the stream echoes it, and notes an interrupt and a failed turn", () => {
    const transcript = empty_transcript();
    add_user_message(transcript, "message", "u1", "Go faster.", "2026-11-20T10:00:00Z");
    expect(pending_messages(transcript)).toHaveLength(1);

    expect(fold_stream_message(transcript, { type: "user", uuid: "u1", isReplay: true, message: { content: [{ type: "text", text: "Go faster." }] } })).toBe(true);
    expect(fold_stream_message(transcript, { type: "user", uuid: "u1", message: { content: "Go faster." } })).toBe(false);
    expect(pending_messages(transcript)).toEqual([]);

    fold_stream_message(transcript, { type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } });
    fold_stream_message(transcript, { type: "result", is_error: true, terminal_reason: "aborted_tools" });
    fold_stream_message(transcript, { type: "result", is_error: true, subtype: "error_max_turns", result: "" });
    expect(transcript.entries.slice(1)).toEqual([
      { kind: "notice", tone: "warn", text: "Interrupted. The session waits for your message." },
      { kind: "notice", tone: "bad", text: "The turn ended with an error (error_max_turns)." },
    ]);
  });

  it("takes the model and mode from the session's start and ignores what it does not show", () => {
    const transcript = empty_transcript();
    expect(fold_stream_message(transcript, { type: "system", subtype: "init", model: "stand-in-model", permissionMode: "auto" })).toBe(true);
    expect(fold_stream_message(transcript, { type: "rate_limit_event" })).toBe(false);
    expect(fold_stream_message(transcript, event("gone", { type: "content_block_delta", delta: { type: "text_delta", text: "x" } }))).toBe(false);
    expect(fold_stream_message(transcript, event("gone", { type: "content_block_start", content_block: { type: "image" } }))).toBe(false);
    expect(fold_stream_message(transcript, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "nobody" }] } })).toBe(false);
    expect(transcript).toMatchObject({ model: "stand-in-model", mode: "auto", entries: [] });
  });
});

describe("a stored transcript", () => {
  it("drops the earliest steps past its size, keeping the starting input first", () => {
    const transcript = empty_transcript();
    add_user_message(transcript, "input", "u0", "The starting input.");
    for (let index = 0; index < 50; index += 1) transcript.entries.push({ kind: "text", text: `step ${index} ${"x".repeat(100)}` });

    const stored = read_transcript(stored_transcript(transcript, 3000));
    expect(stored.entries[0]).toMatchObject({ kind: "user", role: "input" });
    expect(stored.dropped).toBeGreaterThan(0);
    expect(stored.entries.at(-1)).toMatchObject({ text: expect.stringContaining("step 49") });
    expect(JSON.stringify(stored).length).toBeLessThanOrEqual(3000);
  });

  it("reads as empty when missing or damaged, and closes blocks a session left open", () => {
    expect(read_transcript("")).toEqual(empty_transcript());
    expect(read_transcript("{not json")).toEqual(empty_transcript());
    const transcript = read_transcript(JSON.stringify({ entries: [{ kind: "text", text: "half", streaming: true }] }));
    close_open_blocks(transcript);
    expect(transcript.entries).toEqual([{ kind: "text", text: "half", streaming: false }]);
  });
});

describe("a tool call described", () => {
  it("in one line by what it works on", () => {
    expect(tool_summary({ file_path: "src/a.ts", content: "x" })).toBe("src/a.ts");
    expect(tool_summary({ command: "npm   test\n -- a" })).toBe("npm test -- a");
    expect(tool_summary({ pattern: "TODO" })).toBe("TODO");
    expect(tool_summary({ command: "x".repeat(200) })).toHaveLength(161);
    expect(tool_summary({})).toBe("");
  });

  it("as the change an editing tool makes", () => {
    expect(edit_of("Edit", { file_path: "a.ts", old_string: "a", new_string: "b" })).toEqual([{ path: "a.ts", before: "a", after: "b" }]);
    expect(edit_of("Write", { file_path: "b.ts", content: "new" })).toEqual([{ path: "b.ts", before: "", after: "new" }]);
    expect(edit_of("MultiEdit", { file_path: "c.ts", edits: [{ old_string: "1", new_string: "2" }] })).toEqual([{ path: "c.ts", before: "1", after: "2" }]);
    expect(edit_of("Bash", { command: "ls" })).toBeNull();
  });
});

describe("a permission request", () => {
  it("waits until decided, and is denied when the session ends first", () => {
    const transcript = empty_transcript();
    add_permission(transcript, { id: "p1", tool: "Write", input: { file_path: "a", content: "y".repeat(9000) }, reason: "Outside the folder." });
    add_permission(transcript, { id: "p2", tool: "Bash", input: { command: "ls" }, reason: "" });
    expect(waiting_permissions(transcript).map((entry) => entry.id)).toEqual(["p1", "p2"]);
    expect(String(waiting_permissions(transcript)[0]!.input.content)).toContain("more characters left out");

    Object.assign(transcript.entries[0]!, { decision: "allowed" });
    close_open_blocks(transcript);

    expect(waiting_permissions(transcript)).toEqual([]);
    expect(transcript.entries[1]).toMatchObject({ decision: "denied", message: "The session ended first." });
  });

  it("allowed for the session covers the tool, or a command's program", () => {
    expect(permission_rule("Bash", { command: "  git status" })).toBe("Bash(git)");
    expect(permission_rule("Bash", { command: "" })).toBe("Bash");
    expect(permission_rule("Write", { file_path: "a" })).toBe("Write");
    expect(rule_covers("Bash(git)", "Bash", { command: "git log" })).toBe(true);
    expect(rule_covers("Bash(git)", "Bash", { command: "rm -rf x" })).toBe(false);
    expect(rule_covers("Write", "Write", {})).toBe(true);
    expect(rule_words("Bash(npm)")).toBe("npm commands");
    expect(rule_words("Write")).toBe("Write");
  });
});
