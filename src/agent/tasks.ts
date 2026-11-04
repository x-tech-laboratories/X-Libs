// How an agent carries out the app's tasks: to their end, as a stream, or as a long run's own process. Shell tasks, a
// command line run by sh, come built in; an app with typed operations gives its own.

// ── Imports ──────────────────────────────────────────────────────────────────

import { type CommandStream, run_command, stream_command } from "./commands.ts";
import type { RunResult } from "./protocol.ts";

// ── Runner ───────────────────────────────────────────────────────────────────

// The program a long run's process starts as, which writes everything it prints to `<folder>/out` and its exit code
// to `<folder>/exit`, renamed into place in one step.
export interface LongRunLaunch {
  program: string;
  args: string[];
}

export interface TaskRunner<Task> {
  run(task: Task, options: { timeout_in_seconds: number; stdin?: string | null }): Promise<RunResult>;
  // Hands back stdout as it comes; an app without streams leaves it out.
  stream?(task: Task, options: { stdin?: string | null }): CommandStream;
  // Writes whatever the run's process needs into its folder and says how to start it.
  launch(task: Task, folder: string, has_stdin: boolean): LongRunLaunch;
}

// ── Shell ────────────────────────────────────────────────────────────────────

// The outer shell runs the command with its output in the run's folder, then writes the exit code in one rename.
const wrapper = 'sh -c "$2" > "$1/out" 2>&1; echo $? > "$1/exit.part"; mv -f "$1/exit.part" "$1/exit"';

// Runs each task as a command line under sh; `process_name`, such as "x-backups-run", is what ps shows for a long run.
export function shell_runner(process_name: string): TaskRunner<string> {
  return {
    run: (command, options) => run_command(command, options),
    stream: (command, options) => stream_command(command, options),
    launch: (command, folder) => ({ program: "sh", args: ["-c", wrapper, process_name, folder, command] }),
  };
}
