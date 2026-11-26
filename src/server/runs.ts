// Follows a long run on an agent: copies its new output to where the app keeps it, and finishes once the run has ended.

// ── Imports ──────────────────────────────────────────────────────────────────

import { parse_long_run_poll, unknown_run_message, type LongRunPoll } from "../agent/protocol.ts";
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
  // Unreachable leaves the run as it was, to be followed again, whether the agent could not be reached or its answer could not be used.
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

// One follow takes at most this many polls, and the next follow carries on where it stopped.
export const most_polls_per_follow = 256;

// One follow copies at most about this much output, and the next follow carries on where it stopped.
export const most_output_per_follow_in_bytes = 64 * 1024 * 1024;

// Copies the run's new output into the sink and finishes it once ended; any failure but the agent not knowing the run leaves it "unreachable", to be followed again.
export async function follow_run(source: RunSource, run_id: string, output_offset: number, sink: RunSink, options: FollowOptions = {}): Promise<Followed> {
  let offset = output_offset;
  let taken_in_bytes = 0;
  let latest: LongRunPoll;
  for (let polls = 1; ; polls++) {
    let reply: unknown;
    try {
      reply = await source.poll(run_id, offset);
    } catch (error) {
      if (error instanceof AgentError && !error.unreachable && error.message === unknown_run_message(run_id)) {
        return finish_run(source, run_id, sink, options, null);
      }
      return { outcome: "unreachable", error: message_of(error) };
    }
    const checked = checked_poll(reply, offset);
    if (typeof checked === "string") return { outcome: "unreachable", error: `The agent's answer to a poll of ${run_id} ${checked}.` };
    latest = checked;
    try {
      sink.append_output(translated(options, latest.new_output, false), latest.next_offset);
    } catch (error) {
      return { outcome: "unreachable", error: message_of(error) };
    }
    taken_in_bytes += Math.max(latest.next_offset - offset, latest.new_output.length);
    offset = latest.next_offset;
    if (latest.new_output === "" || offset >= latest.size) break;
    // A run with more output than one follow takes is still being copied, so it is not finished yet.
    if (polls >= most_polls_per_follow || taken_in_bytes >= most_output_per_follow_in_bytes) return { outcome: "running", error: "" };
  }
  if (latest.alive) return { outcome: "running", error: "" };
  return finish_run(source, run_id, sink, options, latest.exit_code);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Finishes the run in the sink and forgets it on the agent; a sink that fails leaves it to be followed again.
async function finish_run(source: RunSource, run_id: string, sink: RunSink, options: FollowOptions, exit_code: number | null): Promise<Followed> {
  let error: string | null = null;
  if (exit_code === null) error = "The run ended without writing an exit code";
  else if (exit_code !== 0) error = options.describe?.(exit_code) ?? `Exited with status ${exit_code}`;
  try {
    if (options.translate !== undefined) sink.append_output(translated(options, "", true));
    sink.finish(error === null ? "succeeded" : "failed", exit_code, error);
  } catch (failure) {
    return { outcome: "unreachable", error: message_of(failure) };
  }
  try {
    await source.forget(run_id);
  } catch {
    // The run is already finished in the sink, and an output left on the agent does no harm.
  }
  return { outcome: "ended", error: error ?? "" };
}

// The chunk as the app's translate gives it, or as it came when the translate fails, so no output is lost.
function translated(options: FollowOptions, chunk: string, ended: boolean): string {
  if (options.translate === undefined) return chunk;
  try {
    return options.translate(chunk, ended);
  } catch {
    return chunk;
  }
}

// The poll reply when it is well formed and moves on from the offset asked for, or what is wrong with it.
function checked_poll(reply: unknown, offset: number): LongRunPoll | string {
  const poll = parse_long_run_poll(reply);
  if (poll === null) return "is malformed";
  if (poll.next_offset < offset) return "goes back in its output";
  if (poll.new_output !== "" && poll.next_offset === offset) return "does not move on in its output";
  return poll;
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
