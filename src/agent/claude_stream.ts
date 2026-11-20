// A Claude Code session driven over its stream-json protocol, as `claude -p --input-format stream-json
// --output-format stream-json` speaks it: user messages written to its input at any time, control requests such as an
// interrupt or a change of permission mode answered by id, the session's own requests, such as asking whether a tool
// may run, answered back, and every other line it prints handed on whole and parsed.

// ── Imports ──────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

import { start_line_program, type LineProgramExit } from "./programs.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type StreamMessage = Record<string, unknown>;

export interface ClaudeStreamOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  // Each line the session prints, with its JSON when it is JSON; answers to this side's control requests are kept back.
  on_line: (line: string, message: StreamMessage | null) => void;
  // A request from the session, such as can_use_tool, answered later through respond; any it does not take is refused.
  on_request?: (request_id: string, request: StreamMessage) => boolean;
  // How long a control request waits for its answer; 30 seconds unless set.
  control_timeout_in_milliseconds?: number;
}

export interface ClaudeStream {
  // Writes a user message with the id the session echoes back once it has read it.
  send_user: (text: string, id: string) => void;
  // Sends a control request, such as {subtype: "interrupt"}, and settles with the session's answer.
  control: (request: StreamMessage) => Promise<StreamMessage>;
  // Answers one of the session's own requests.
  respond: (request_id: string, response: StreamMessage) => void;
  // Closes the input, after which the session ends once its turn is over.
  end_input: () => void;
  is_open: () => boolean;
  finished: Promise<LineProgramExit>;
}

const default_control_timeout_in_milliseconds = 30_000;

// ── Messages ─────────────────────────────────────────────────────────────────

// The line that writes a user message to the session.
export function user_message_line(text: string, id: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, uuid: id });
}

// The answer allowing a tool call the session asked about, with the input it may run with.
export function allow_tool(input: StreamMessage): StreamMessage {
  return { behavior: "allow", updatedInput: input };
}

// The answer refusing a tool call, with the reason the agent is given.
export function deny_tool(message: string): StreamMessage {
  return { behavior: "deny", message: message || "The user refused this tool call." };
}

// ── Session ──────────────────────────────────────────────────────────────────

export function start_claude_stream(argv: readonly string[], options: ClaudeStreamOptions): ClaudeStream {
  const waiting = new Map<string, { resolve: (answer: StreamMessage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const timeout = options.control_timeout_in_milliseconds ?? default_control_timeout_in_milliseconds;

  function on_line(line: string): void {
    if (!line.trim()) return;
    let message: StreamMessage | null = null;
    try {
      message = JSON.parse(line) as StreamMessage;
    } catch {
      message = null;
    }
    if (message?.type === "control_response") {
      const response = (message.response ?? {}) as StreamMessage;
      const waiter = waiting.get(String(response.request_id ?? ""));
      if (!waiter) return;
      waiting.delete(String(response.request_id));
      clearTimeout(waiter.timer);
      if (response.subtype === "error") waiter.reject(new Error(String(response.error ?? "the session refused the request")));
      else waiter.resolve((response.response ?? {}) as StreamMessage);
      return;
    }
    if (message?.type === "control_request") {
      const request_id = String(message.request_id ?? "");
      const taken = options.on_request?.(request_id, (message.request ?? {}) as StreamMessage) ?? false;
      if (!taken) program.write_line(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id, error: "This program does not answer this request" } }));
      return;
    }
    options.on_line(line, message);
  }

  const program = start_line_program(argv, { cwd: options.cwd, env: options.env, signal: options.signal, on_line });
  const finished = program.finished.then((exit) => {
    for (const [id, waiter] of waiting) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("the session ended before it answered"));
      waiting.delete(id);
    }
    return exit;
  });

  return {
    send_user: (text, id) => program.write_line(user_message_line(text, id)),
    control: (request) =>
      new Promise<StreamMessage>((resolve, reject) => {
        if (!program.is_open()) return reject(new Error("the session is no longer taking requests"));
        const request_id = randomUUID();
        const timer = setTimeout(() => {
          waiting.delete(request_id);
          reject(new Error("the session did not answer in time"));
        }, timeout);
        waiting.set(request_id, { resolve, reject, timer });
        program.write_line(JSON.stringify({ type: "control_request", request_id, request }));
      }),
    respond: (request_id, response) => program.write_line(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id, response } })),
    end_input: program.end_input,
    is_open: program.is_open,
    finished,
  };
}
