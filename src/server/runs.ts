// Follows a long run on an agent: copies its new output to where the app keeps it, and finishes once the run has ended.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { LongRunPoll } from "../agent/protocol.ts";
import { AgentError } from "./agents/agent.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// The part of an agent that is followed.
export interface RunSource {
  poll(run_id: string, offset: number): Promise<LongRunPoll>;
  forget(run_id: string): Promise<void>;
}

// Where the app keeps what the run printed and how it ended.
export interface RunSink {
  // Adds output, and the offset in the run's output the next poll starts at, when the output came from a poll.
  append_output(text: string, next_offset?: number): void;
  finish(state: "succeeded" | "failed", exit_code: number | null, error: string | null): void;
}

export interface Followed {
  outcome: "running" | "ended" | "unreachable";
  error: string;
}

export interface FollowOptions {
  // Names a failing exit code its owner knows better, such as a timeout; null leaves "Exited with status N".
  describe?: (exit_code: number) => string | null;
  // Rewrites a piece of output before it is kept, such as nix's structured log; `ended` is set once, with nothing more to come.
  translate?: (chunk: string, ended: boolean) => string;
}

// ── Following ────────────────────────────────────────────────────────────────

// Copies the run's new output into the sink, and finishes it once the run has ended; an agent that cannot be reached leaves
// the run as it was, to be followed again.
export async function follow_run(source: RunSource, run_id: string, output_offset: number, sink: RunSink, options: FollowOptions = {}): Promise<Followed> {
  let offset = output_offset;
  let poll: Pick<LongRunPoll, "alive" | "exit_code">;
  try {
    let latest: LongRunPoll;
    do {
      latest = await source.poll(run_id, offset);
      sink.append_output(options.translate === undefined ? latest.new_output : options.translate(latest.new_output, false), latest.next_offset);
      offset = latest.next_offset;
    } while (offset < latest.size && latest.new_output !== "");
    poll = latest;
  } catch (error) {
    if (error instanceof AgentError && error.unreachable) return { outcome: "unreachable", error: error.message };
    // A run the agent no longer knows has ended without a word.
    poll = { alive: false, exit_code: null };
  }
  if (poll.alive) return { outcome: "running", error: "" };
  if (options.translate !== undefined) sink.append_output(options.translate("", true));

  let error: string | null = null;
  if (poll.exit_code === null) error = "The run ended without writing an exit code";
  else if (poll.exit_code !== 0) error = options.describe?.(poll.exit_code) ?? `Exited with status ${poll.exit_code}`;
  sink.finish(error === null ? "succeeded" : "failed", poll.exit_code, error);
  await source.forget(run_id);
  return { outcome: "ended", error: error ?? "" };
}
