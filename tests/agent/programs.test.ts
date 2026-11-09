import { describe, expect, it } from "vitest";
import { BoundedBuffer, on_path, run_program, type Sink } from "../../src/agent/programs.ts";

function collector(): Sink & { text: () => string } {
  const chunks: string[] = [];
  return { write: (chunk) => void chunks.push(chunk.toString()), text: () => chunks.join("") };
}

describe("programs", () => {
  it("runs a program with its arguments, never through a shell", async () => {
    const result = await run_program(["printf", "%s", "$HOME; echo no"]);

    expect(result).toEqual({ exit_code: 0, stdout: "$HOME; echo no", stderr: "" });
  });

  it("shows, keeps or drops each stream as asked", async () => {
    const out = collector();
    const err = collector();

    const result = await run_program(["sh", "-c", "echo out; echo err >&2"], { stdout: "show", stderr: "both", out, err });

    expect(out.text()).toBe("out\n");
    expect(err.text()).toBe("err\n");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("err\n");
  });

  it("feeds stdin and answers the exit code", async () => {
    const result = await run_program(["sh", "-c", "cat; exit 4"], { stdin: "secret" });

    expect(result).toEqual({ exit_code: 4, stdout: "secret", stderr: "" });
  });

  it("answers 127 for a program that is not installed", async () => {
    const result = await run_program(["x-libs-no-such-program"]);

    expect(result.exit_code).toBe(127);
    expect(result.stderr).toBe("x-libs-no-such-program is not installed on this host");
  });

  it("stops the program and its children once aborted", async () => {
    const controller = new AbortController();
    const running = run_program(["sh", "-c", "sleep 30 & wait"], { signal: controller.signal, own_group: true });

    controller.abort();

    expect((await running).exit_code).toBe(128 + 15);
  });

  it("does not start a program already aborted", async () => {
    const result = await run_program(["true"], { signal: AbortSignal.abort() });

    expect(result).toEqual({ exit_code: -1, stdout: "", stderr: "Stopped before it started" });
  });

  it("keeps a buffer to its limit and notes what it dropped", () => {
    const buffer = new BoundedBuffer(4);

    buffer.write("abc");
    buffer.write("def");

    expect(buffer.text()).toBe("abcd");
    expect(buffer.truncated).toBe(true);
  });

  it("finds a program on the PATH", async () => {
    expect(await on_path("sh")).toMatch(/\/sh$/);
    expect(await on_path("x-libs-no-such-program")).toBeNull();
  });
});
