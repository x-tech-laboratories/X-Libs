import { describe, expect, it } from "vitest";
import { BoundedBuffer, on_path, run_program, whole_lines, type Sink } from "../../src/agent/programs.ts";

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

  it("passes on only whole lines, decoding characters split across chunks", () => {
    const written: string[] = [];
    const lined = whole_lines({ write: (chunk) => void written.push(String(chunk)) });
    const snowman = Buffer.from("☃");

    lined.write('@nix {"a"');
    lined.write(":1}\nhalf");
    lined.write(Buffer.concat([Buffer.from(" "), snowman.subarray(0, 1)]));
    lined.write(Buffer.concat([snowman.subarray(1), Buffer.from("\n")]));
    lined.write("rest");
    lined.flush();

    expect(written).toEqual(['@nix {"a":1}\n', "half ☃\n", "rest\n"]);
  });

  it("flushes nothing when every line was whole", () => {
    const written: string[] = [];
    const lined = whole_lines({ write: (chunk) => void written.push(String(chunk)) });

    lined.write("one\ntwo\n");
    lined.flush();

    expect(written).toEqual(["one\ntwo\n"]);
  });
});
