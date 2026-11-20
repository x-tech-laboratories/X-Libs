import { describe, expect, it } from "vitest";

import { start_line_program } from "../../src/agent/programs.ts";

describe("a program talked to in lines", () => {
  it("hands on each line it prints and reads the lines written to it until its input closes", async () => {
    const lines: string[] = [];
    const program = start_line_program(["sh", "-c", "echo ready; while read line; do echo \"got $line\"; done; printf tail; echo oops >&2; exit 3"], { on_line: (line) => lines.push(line) });

    program.write_line("one");
    program.write_line("two");
    expect(program.is_open()).toBe(true);
    program.end_input();
    program.end_input();
    program.write_line("ignored");
    const exit = await program.finished;

    expect(program.is_open()).toBe(false);
    expect(lines).toEqual(["ready", "got one", "got two", "tail"]);
    expect(exit).toEqual({ exit_code: 3, stderr: "oops\n" });
  });

  it("keeps a character split across chunks whole", async () => {
    const lines: string[] = [];
    const program = start_line_program(["sh", "-c", "printf '\\303'; sleep 0.05; printf '\\251t\\n'"], { on_line: (line) => lines.push(line) });

    await program.finished;

    expect(lines).toEqual(["ét"]);
  });

  it("stops the program and all it started when the signal aborts", async () => {
    const controller = new AbortController();
    const program = start_line_program(["sh", "-c", "sleep 30 & wait"], { signal: controller.signal, on_line: () => undefined });

    controller.abort();
    const exit = await program.finished;

    expect(exit.exit_code).toBe(128 + 15);
  });

  it("answers 127 for a program that is not installed and -1 for a signal already aborted", async () => {
    const missing = await start_line_program(["x-libs-no-such-program"], { on_line: () => undefined }).finished;
    const controller = new AbortController();
    controller.abort();
    const stopped = start_line_program(["true"], { signal: controller.signal, on_line: () => undefined });
    stopped.write_line("nothing");
    stopped.end_input();

    expect(missing).toEqual({ exit_code: 127, stderr: "x-libs-no-such-program is not installed on this host" });
    expect(stopped.is_open()).toBe(false);
    expect(await stopped.finished).toEqual({ exit_code: -1, stderr: "Stopped before it started" });
  });
});
