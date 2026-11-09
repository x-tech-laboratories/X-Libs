import { describe, expect, it } from "vitest";
import type { LongRunPoll } from "../../src/agent/protocol.ts";
import { AgentError } from "../../src/server/agents/agent.ts";
import { follow_run, type RunSink, type RunSource } from "../../src/server/runs.ts";

function poll(overrides: Partial<LongRunPoll>): LongRunPoll {
  return { state: "running", exit_code: null, alive: true, size: 0, new_output: "", next_offset: 0, ...overrides };
}

function setup(polls: (LongRunPoll | Error)[]) {
  const kept: string[] = [];
  const offsets: number[] = [];
  const finished: unknown[][] = [];
  const forgotten: string[] = [];
  const source: RunSource = {
    poll: async (_run, offset) => {
      offsets.push(offset);
      const next = polls.shift()!;
      if (next instanceof Error) throw next;
      return next;
    },
    forget: async (run) => void forgotten.push(run),
  };
  const sink: RunSink = { append_output: (text) => void kept.push(text), finish: (...result) => void finished.push(result) };
  return { source, sink, kept, offsets, finished, forgotten };
}

describe("follow_run", () => {
  it("copies output while the run is alive and finishes nothing", async () => {
    const { source, sink, kept, finished } = setup([poll({ new_output: "hello", size: 5, next_offset: 5 })]);

    expect(await follow_run(source, "run-1", 0, sink)).toEqual({ outcome: "running", error: "" });
    expect(kept).toEqual(["hello"]);
    expect(finished).toEqual([]);
  });

  it("keeps polling while a poll returns only part of the output", async () => {
    const { source, sink, kept, offsets } = setup([
      poll({ new_output: "ab", size: 4, next_offset: 2 }), poll({ new_output: "cd", size: 4, next_offset: 4, alive: false, exit_code: 0 }),
    ]);

    await follow_run(source, "run-1", 0, sink);

    expect(kept).toEqual(["ab", "cd"]);
    expect(offsets).toEqual([0, 2]);
  });

  it("finishes a run that ended with status 0 as succeeded, and forgets it", async () => {
    const { source, sink, finished, forgotten } = setup([poll({ alive: false, exit_code: 0 })]);

    expect(await follow_run(source, "run-1", 0, sink)).toEqual({ outcome: "ended", error: "" });
    expect(finished).toEqual([["succeeded", 0, null]]);
    expect(forgotten).toEqual(["run-1"]);
  });

  it("fails a run by its status, in its owner's words when it has them, and for no exit code", async () => {
    const plain = setup([poll({ alive: false, exit_code: 2 })]);
    const described = setup([poll({ alive: false, exit_code: 124 })]);
    const silent = setup([poll({ alive: false, exit_code: null })]);

    await follow_run(plain.source, "r", 0, plain.sink);
    await follow_run(described.source, "r", 0, described.sink, { describe: (code) => (code === 124 ? "Timed out" : null) });
    await follow_run(silent.source, "r", 0, silent.sink);

    expect(plain.finished).toEqual([["failed", 2, "Exited with status 2"]]);
    expect(described.finished).toEqual([["failed", 124, "Timed out"]]);
    expect(silent.finished).toEqual([["failed", null, "The run ended without writing an exit code"]]);
  });

  it("translates each piece, and once more at the end", async () => {
    const { source, sink, kept } = setup([poll({ new_output: "raw", size: 3, next_offset: 3, alive: false, exit_code: 0 })]);

    await follow_run(source, "r", 0, sink, { translate: (chunk, ended) => (ended ? "[end]" : chunk.toUpperCase()) });

    expect(kept).toEqual(["RAW", "[end]"]);
  });

  it("leaves a run it cannot reach, and ends one the agent no longer knows", async () => {
    const unreachable = setup([new AgentError("No agent", true)]);
    const unknown = setup([new AgentError("No such run", false)]);

    expect(await follow_run(unreachable.source, "r", 0, unreachable.sink)).toEqual({ outcome: "unreachable", error: "No agent" });
    expect(unreachable.finished).toEqual([]);
    expect(await follow_run(unknown.source, "r", 0, unknown.sink)).toMatchObject({ outcome: "ended" });
    expect(unknown.finished[0][0]).toBe("failed");
  });
});
