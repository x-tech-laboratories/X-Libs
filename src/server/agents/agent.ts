// What the server can ask of one host's agent, whether it is connected over a WebSocket or built into the server.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Readable } from "node:stream";

import type { CommandStream } from "../../agent/commands.ts";
import type { LongRun, LongRunPoll, RunResult } from "../../agent/protocol.ts";

export type { CommandStream } from "../../agent/commands.ts";
export type { LongRun, LongRunPoll, LongRunState, RunResult } from "../../agent/protocol.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface AgentRunOptions {
  timeout_in_seconds: number;
  // Fed to the command, as when it needs a passphrase.
  stdin?: string | null;
}

export interface AgentStreamOptions {
  stdin?: string | null;
}

export class AgentError extends Error {
  // Whether the host never answered, so trying again later may work, rather than answering that it failed.
  readonly unreachable: boolean;

  constructor(message: string, unreachable = false) {
    super(message);
    this.name = "AgentError";
    this.unreachable = unreachable;
  }
}

// A stream that has already ended with an error, for a host with no agent or a run that cannot be followed.
export function ended_stream(stderr: string): CommandStream {
  return { stdout: Readable.from([]), done: Promise.resolve({ exit_code: -1, stderr }), stop: () => {} };
}

// ── Agent ────────────────────────────────────────────────────────────────────

export interface Agent {
  // Runs a command to its end; it never rejects, answering a failure to reach the host with exit code -1.
  run(command: string, options: AgentRunOptions): Promise<RunResult>;
  // Runs a command with no timeout, handing back its stdout as it comes.
  stream(command: string, options?: AgentStreamOptions): CommandStream;
  // Starts a long run, which outlives the connection, the agent and the server; rejects with an AgentError.
  start(run_id: string, command: string, options?: AgentStreamOptions): Promise<LongRun>;
  // What a long run has written past an offset in bytes, and whether it has ended; rejects with an AgentError.
  poll(run_id: string, offset: number): Promise<LongRunPoll>;
  // Follows a long run's output from an offset until it ends.
  attach(run_id: string, offset: number): CommandStream;
  // Stops a long run's process group, killing it if it does not end within the grace period.
  stop(run_id: string): Promise<LongRun>;
  // Removes an ended long run's output from the host.
  forget(run_id: string): Promise<void>;
  runs(): Promise<LongRun[]>;
  // Makes one of the app's own requests, such as a health sample; rejects with an AgentError.
  request(type: string, body?: Record<string, unknown>): Promise<unknown>;
}
