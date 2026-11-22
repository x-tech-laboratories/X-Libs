import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LongRuns } from "../../src/agent/long_runs.ts";
import { shell_runner } from "../../src/agent/tasks.ts";

let state: string;
let runs: LongRuns<string>;

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "x-libs-runs-"));
  runs = new LongRuns(state, shell_runner("x-test-run"), { kill_grace_in_milliseconds: 300, tail_interval_in_milliseconds: 20 });
});

afterEach(async () => {
  for (const run of runs.list()) if (run.state === "running") await runs.stop(run.run_id);
});

async function ended(run_id: string) {
  for (;;) {
    const run = runs.get(run_id);
    if (run.state !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("long runs", () => {
  it("keeps a run's output and exit code, and feeds it stdin without writing it down", async () => {
    runs.start("one", "cat; echo err >&2; exit 3", "secret\n");
    expect((await ended("one")).exit_code).toBe(3);

    const poll = await runs.poll("one", 0);
    expect(poll).toMatchObject({ state: "exited", exit_code: 3, alive: false, new_output: "secret\nerr\n", next_offset: 11, size: 11 });
    expect((await runs.poll("one", 7)).new_output).toBe("err\n");
  });

  it("returns a large output in whole lines, carrying on from where the last poll stopped", async () => {
    runs.start("big", "yes 'a line' | head -n 200000", null);
    await ended("big");
    const first = await runs.poll("big", 0);
    expect(first.next_offset).toBeLessThan(first.size);
    expect(first.new_output.endsWith("\n")).toBe(true);
    let offset = first.next_offset;
    let text = first.new_output;
    while (offset < first.size) {
      const next = await runs.poll("big", offset);
      text += next.new_output;
      offset = next.next_offset;
    }
    expect(text).toBe("a line\n".repeat(200000));
  });

  it("refuses a run id that is taken or unsafe", () => {
    runs.start("taken", "true", null);
    expect(() => runs.start("taken", "true", null)).toThrow(/already exists/);
    expect(() => runs.start("../escape", "true", null)).toThrow(/not a valid run id/);
  });

  it("stops a run's whole process group", async () => {
    runs.start("long", "sleep 30 & wait", null);
    const stopped = await runs.stop("long");
    expect(stopped.state).toBe("stopped");
    expect((await runs.poll("long", 0)).alive).toBe(false);
  });

  it("follows a run's output until it ends", async () => {
    runs.start("ticks", "for i in 1 2 3; do echo $i; sleep 0.05; done", null);
    const stream = runs.tail("ticks", 0);
    const chunks: Buffer[] = [];
    stream.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    expect(await stream.done).toEqual({ exit_code: 0, stderr: "" });
    expect(Buffer.concat(chunks).toString()).toBe("1\n2\n3\n");
  });

  it("reports a run whose process vanished without an exit code as lost, and forgets ended runs", async () => {
    const folder = join(state, "runs", "vanished");
    mkdirSync(folder);
    writeFileSync(join(folder, "out"), "partial");
    writeFileSync(join(folder, "run.json"), JSON.stringify({ run_id: "vanished", pid: 2 ** 22 + 1, start_ticks: 1, started_epoch: 1 }));
    expect(runs.get("vanished")).toMatchObject({ state: "lost", exit_code: null });

    runs.prune(0);
    expect(runs.list()).toEqual([]);
  });

  it("is found by a new instance reading the same folder", async () => {
    runs.start("adopted", "sleep 0.3; echo done", null);
    const later = new LongRuns(state, shell_runner("x-test-run"));
    expect(later.list()).toMatchObject([{ run_id: "adopted", state: "running" }]);
    while (later.get("adopted").state === "running") await new Promise((resolve) => setTimeout(resolve, 20));
    expect(later.get("adopted")).toMatchObject({ state: "exited", exit_code: 0 });
  });

  it("names the run's outer shell for ps", async () => {
    const run = runs.start("named", "sleep 30", null);
    const command_line = readFileSync(`/proc/${run.pid}/cmdline`, "utf8").split("\0");
    expect(command_line).toContain("x-test-run");
    await runs.stop("named");
  });

  it("starts a run as the program the app's runner names", async () => {
    // A runner of the app's own, whose process writes its output and exit code itself.
    const script = 'const [folder, word] = process.argv.slice(1); const fs = require("node:fs"); fs.writeFileSync(folder + "/out", word + "\\n"); fs.writeFileSync(folder + "/exit.part", "5\\n"); fs.renameSync(folder + "/exit.part", folder + "/exit");';
    const typed = new LongRuns<{ word: string }>(state, {
      run: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
      launch: (task, folder) => ({ program: process.execPath, args: ["-e", script, folder, task.word] }),
    });

    typed.start("typed", { word: "hello" }, null);
    while (typed.get("typed").state === "running") await new Promise((resolve) => setTimeout(resolve, 20));

    expect(typed.get("typed")).toMatchObject({ state: "exited", exit_code: 5 });
    expect((await typed.poll("typed", 0)).new_output).toBe("hello\n");
  });
});

// Stands in for systemd-run, systemctl stop and systemctl show: each unit is a process in a session of its own.
const fake_systemd = `
dir=$1; mode=$2; shift 2
case $mode in
run)
  echo "$*" >> "$dir/started"
  while [ $# -gt 0 ]; do
    case $1 in
      --unit=*) unit=\${1#--unit=} ;;
      --working-directory=*) cwd=\${1#*=} ;;
      --property) shift; case $1 in StandardInput=file:*) input=\${1#StandardInput=file:} ;; EnvironmentFile=*) environment=\${1#EnvironmentFile=} ;; esac ;;
      --) shift; break ;;
    esac
    shift
  done
  [ -n "$input" ] || input=/dev/null
  (cd "$cwd" && set -a && . "$environment" && set +a && exec setsid "$@" < "$input") > /dev/null 2>&1 &
  echo $! > "$dir/$unit"
  ;;
show) cat "$dir/$4" ;;
stop)
  pid=$(cat "$dir/$1")
  kill -TERM -- "-$pid"
  while kill -0 "$pid" 2> /dev/null; do sleep 0.02; done
  ;;
esac
`;

describe("long runs as systemd units", () => {
  let units: string;
  let unit_runs: LongRuns<string>;

  beforeEach(() => {
    units = mkdtempSync(join(tmpdir(), "x-libs-units-"));
    const script = join(units, "fake-systemd");
    writeFileSync(script, fake_systemd, { mode: 0o700 });
    unit_runs = new LongRuns(state, shell_runner("x-test-unit"), {
      kill_grace_in_milliseconds: 300,
      unit: {
        prefix: "x-test",
        slice: "work.slice",
        properties: { OOMScoreAdjust: "500" },
        environment: { PATH: process.env.PATH ?? "", GREETING: 'say "hi" $HOME `x` \\' },
        start_command: ["sh", script, units, "run"],
        stop_command: ["sh", script, units, "stop"],
        show_command: ["sh", script, units, "show"],
      },
    });
  });

  afterEach(async () => {
    for (const run of unit_runs.list()) if (run.state === "running") await unit_runs.stop(run.run_id);
  });

  async function unit_ended(run_id: string) {
    while (unit_runs.get(run_id).state === "running") await new Promise((resolve) => setTimeout(resolve, 20));
    return unit_runs.get(run_id);
  }

  it("starts a run in its own unit and slice with the properties given, and hands it stdin through a pipe", async () => {
    const run = unit_runs.start("piped", 'cat; printf "%s\\n" "$GREETING"; exit 4', "secret\n");
    expect(run.pid).toBeGreaterThan(0);
    expect(await unit_ended("piped")).toMatchObject({ state: "exited", exit_code: 4 });
    expect((await unit_runs.poll("piped", 0)).new_output).toBe('secret\nsay "hi" $HOME `x` \\\n');

    const started = readFileSync(join(units, "started"), "utf8");
    expect(started).toContain("--unit=x-test-piped.service");
    expect(started).toContain("--slice=work.slice");
    expect(started).toContain("ExitType=cgroup");
    expect(started).toContain("TimeoutStopSec=300ms");
    expect(started).toContain("OOMScoreAdjust=500");
    expect(started).not.toContain("secret");
    expect(started).not.toContain("hi");
  });

  it("stops a run through its unit", async () => {
    unit_runs.start("long", "sleep 30 & wait", null);
    expect(unit_runs.get("long").state).toBe("running");
    expect((await unit_runs.stop("long")).state).toBe("stopped");
  });

  it("removes the run's folder when its unit cannot start", () => {
    const failing = new LongRuns(state, shell_runner("x-test-unit"), { unit: { prefix: "x-test", start_command: ["sh", "-c", "echo refused >&2; exit 1", "sh"] } });
    expect(() => failing.start("refused", "true", null)).toThrow(/Could not start x-test-refused.service: refused/);
    expect(failing.list()).toEqual([]);
  });
});
