import { describe, expect, it } from "vitest";
import { unknown_run_message, type LongRunPoll } from "../../src/agent/protocol.ts";
import { AgentError } from "../../src/server/agents/agent.ts";
import { follow_run, most_output_per_follow_in_bytes, most_polls_per_follow, type RunSink, type RunSource } from "../../src/server/runs.ts";

function poll(overrides: Partial<LongRunPoll>): LongRunPoll {
  return { state: "running", exit_code: null, alive: true, size: 0, new_output: "", next_offset: 0, ...overrides };
}

function setup(polls: (LongRunPoll | Error | Record<string, unknown>)[]) {
  const kept: string[] = [];
  const offsets: number[] = [];
  const finished: unknown[][] = [];
  const forgotten: string[] = [];
  const source: RunSource = {
    poll: async (_run, offset) => {
      offsets.push(offset);
      const next = polls.shift()!;
      if (next instanceof Error) throw next;
      return next as LongRunPoll;
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
    const unknown = setup([new AgentError(unknown_run_message("r"), false)]);

    expect(await follow_run(unreachable.source, "r", 0, unreachable.sink)).toEqual({ outcome: "unreachable", error: "No agent" });
    expect(unreachable.finished).toEqual([]);
    expect(await follow_run(unknown.source, "r", 0, unknown.sink)).toMatchObject({ outcome: "ended" });
    expect(unknown.finished).toEqual([["failed", null, "The run ended without writing an exit code"]]);
    expect(unknown.forgotten).toEqual(["r"]);
  });

  it("leaves a run whose poll failed for any other reason, to be followed again", async () => {
    const refused = setup([new AgentError("Could not read the output", false)]);
    const thrown = setup([new Error("socket hiccup")]);

    expect(await follow_run(refused.source, "r", 0, refused.sink)).toEqual({ outcome: "unreachable", error: "Could not read the output" });
    expect(await follow_run(thrown.source, "r", 0, thrown.sink)).toEqual({ outcome: "unreachable", error: "socket hiccup" });
    expect([...refused.finished, ...thrown.finished, ...refused.forgotten, ...thrown.forgotten]).toEqual([]);
  });

  it("stops on a reply whose offset does not move on or goes back, and finishes nothing", async () => {
    const stuck = setup([poll({ new_output: "x", size: 1e12, next_offset: 0 })]);
    const backwards = setup([poll({ new_output: "", size: 100, next_offset: 3 })]);

    expect(await follow_run(stuck.source, "r", 0, stuck.sink)).toEqual({ outcome: "unreachable", error: "The agent's answer to a poll of r does not move on in its output." });
    expect(await follow_run(backwards.source, "r", 10, backwards.sink)).toEqual({ outcome: "unreachable", error: "The agent's answer to a poll of r goes back in its output." });
    expect([...stuck.kept, ...backwards.kept]).toEqual([]);
    expect([...stuck.finished, ...backwards.finished, ...stuck.forgotten, ...backwards.forgotten]).toEqual([]);
  });

  it("treats a reply of the wrong shape as a failed poll rather than an ended run", async () => {
    const replies = [
      { ...poll({}), size: "5" }, { ...poll({}), next_offset: -1 }, { ...poll({}), next_offset: 1.5, size: 3 }, { ...poll({}), next_offset: 9, size: 3 },
      { ...poll({}), alive: "no" }, { ...poll({}), new_output: 5 }, { ...poll({}), state: "gone" }, { ...poll({}), exit_code: "0" }, null, [],
    ];
    for (const reply of replies) {
      const { source, sink, kept, finished, forgotten } = setup([reply as Record<string, unknown>]);
      expect(await follow_run(source, "r", 0, sink)).toEqual({ outcome: "unreachable", error: "The agent's answer to a poll of r is malformed." });
      expect([...kept, ...finished, ...forgotten]).toEqual([]);
    }
  });

  it("takes a bounded number of polls from an agent claiming endless output, and carries on later", async () => {
    let polls = 0;
    const kept: string[] = [];
    const finished: unknown[] = [];
    const source: RunSource = {
      poll: async (_run, offset) => {
        polls++;
        return poll({ alive: false, exit_code: 0, new_output: "x", size: 1e12, next_offset: offset + 1 });
      },
      forget: async () => {},
    };
    const sink: RunSink = { append_output: (text) => void kept.push(text), finish: (...result) => void finished.push(result) };

    expect(await follow_run(source, "r", 0, sink)).toEqual({ outcome: "running", error: "" });
    expect(polls).toBe(most_polls_per_follow);
    expect(kept.length).toBe(most_polls_per_follow);
    expect(finished).toEqual([]);
  });

  it("takes a bounded amount of output in one follow", async () => {
    const piece = 1024 * 1024;
    let polls = 0;
    const source: RunSource = {
      poll: async (_run, offset) => {
        polls++;
        return poll({ new_output: "y".repeat(piece), size: 1e12, next_offset: offset + piece });
      },
      forget: async () => {},
    };
    const sink: RunSink = { append_output: () => {}, finish: () => {} };

    expect(await follow_run(source, "r", 0, sink)).toEqual({ outcome: "running", error: "" });
    expect(polls).toBe(most_output_per_follow_in_bytes / piece);
  });

  it("keeps the raw output when translate throws, and does not end a running run", async () => {
    const running = setup([poll({ new_output: "odd line", size: 8, next_offset: 8 })]);
    const translate = () => {
      throw new Error("cannot read this");
    };

    expect(await follow_run(running.source, "r", 0, running.sink, { translate })).toEqual({ outcome: "running", error: "" });
    expect(running.kept).toEqual(["odd line"]);
    expect(running.finished).toEqual([]);

    const ended = setup([poll({ new_output: "last", size: 4, next_offset: 4, alive: false, exit_code: 0 })]);
    expect(await follow_run(ended.source, "r", 0, ended.sink, { translate })).toEqual({ outcome: "ended", error: "" });
    expect(ended.kept).toEqual(["last", ""]);
    expect(ended.finished).toEqual([["succeeded", 0, null]]);
  });

  it("leaves the run to be followed again when the sink fails, and finishes it when forgetting fails", async () => {
    const source = setup([poll({ new_output: "a", size: 1, next_offset: 1, alive: false, exit_code: 0 })]).source;
    const failing_append: RunSink = { append_output: () => { throw new Error("disk full"); }, finish: () => {} };
    expect(await follow_run(source, "r", 0, failing_append)).toEqual({ outcome: "unreachable", error: "disk full" });

    const failing_finish = setup([poll({ alive: false, exit_code: 0 })]);
    failing_finish.sink.finish = () => { throw new Error("database locked"); };
    expect(await follow_run(failing_finish.source, "r", 0, failing_finish.sink)).toEqual({ outcome: "unreachable", error: "database locked" });
    expect(failing_finish.forgotten).toEqual([]);

    const failing_forget = setup([poll({ alive: false, exit_code: 3 })]);
    failing_forget.source.forget = async () => { throw new AgentError("gone", true); };
    expect(await follow_run(failing_forget.source, "r", 0, failing_forget.sink)).toEqual({ outcome: "ended", error: "Exited with status 3" });
    expect(failing_forget.finished).toEqual([["failed", 3, "Exited with status 3"]]);
  });
});
