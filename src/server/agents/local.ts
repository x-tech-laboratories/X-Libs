// The agent built into the server for its own machine. It runs commands itself with no socket between, through the
// same code a remote agent uses, so a command behaves the same on every host.

// ── Imports ──────────────────────────────────────────────────────────────────

import { run_command, stream_command } from "../../agent/commands.ts";
import { LongRuns, type LongRunOptions } from "../../agent/long_runs.ts";
import type { AppMessage } from "../../agent/protocol.ts";
import type { AppRequests } from "../../agent/session.ts";
import {
  AgentError, ended_stream, type Agent, type AgentRunOptions, type AgentStreamOptions, type CommandStream, type LongRun, type LongRunPoll,
  type RunResult,
} from "./agent.ts";

export interface LocalAgentOptions {
  long_runs?: LongRunOptions;
  // The app's own requests, answered by the same handlers its agent uses.
  requests?: AppRequests;
}

// ── Local agent ──────────────────────────────────────────────────────────────

export class LocalAgent implements Agent {
  readonly long_runs: LongRuns;
  private readonly requests: AppRequests;

  // Long runs keep their output under the state directory, so they outlive a restart of the server.
  constructor(state_directory: string, options: LocalAgentOptions = {}) {
    this.long_runs = new LongRuns(state_directory, options.long_runs);
    this.requests = options.requests ?? {};
  }

  run(command: string, options: AgentRunOptions): Promise<RunResult> {
    return run_command(command, options);
  }

  stream(command: string, options: AgentStreamOptions = {}): CommandStream {
    return stream_command(command, options);
  }

  start(run_id: string, command: string, options: AgentStreamOptions = {}): Promise<LongRun> {
    return as_agent_error(() => this.long_runs.start(run_id, command, options.stdin ?? null));
  }

  poll(run_id: string, offset: number): Promise<LongRunPoll> {
    return as_agent_error(() => this.long_runs.poll(run_id, offset));
  }

  attach(run_id: string, offset: number): CommandStream {
    try {
      return this.long_runs.tail(run_id, offset);
    } catch (error) {
      return ended_stream((error as Error).message);
    }
  }

  stop(run_id: string): Promise<LongRun> {
    return as_agent_error(() => this.long_runs.stop(run_id));
  }

  forget(run_id: string): Promise<void> {
    return as_agent_error(() => this.long_runs.forget(run_id));
  }

  async runs(): Promise<LongRun[]> {
    return this.long_runs.list();
  }

  request(type: string, body: Record<string, unknown> = {}): Promise<unknown> {
    if (!Object.hasOwn(this.requests, type)) return Promise.reject(new AgentError(`This agent does not know the request '${type}'.`));
    const message: AppMessage = { ...body, type, id: "local" };
    return as_agent_error(() => this.requests[type](message));
  }
}

async function as_agent_error<Answer>(work: () => Answer | Promise<Answer>): Promise<Answer> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof AgentError ? error : new AgentError((error as Error).message);
  }
}
