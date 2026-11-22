// Jobs an app runs on its own, such as builds, backups or switches: a table of them, and one job's page with its facts,
// its command and its output, followed while it runs, and a Stop button that asks first.

import type { ReactNode } from "react";

import { ToneBadge, type Tone } from "./badges.tsx";
import { confirm_dialog } from "./dialog.tsx";
import { FollowingOutput } from "./following.tsx";
import { Facts, Section, type Fact } from "./layout.tsx";
import { Empty } from "./states.tsx";
import { DataTable, type TableColumn } from "./table.tsx";
import { Age } from "./time.tsx";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type JobState = "running" | "succeeded" | "failed";

export interface JobSummary {
  id: number | string;
  kind: string;
  state: JobState;
  started_epoch: number;
  // Who or what started it, such as a person's name or "schedule".
  trigger: string;
  error: string | null;
  // The last line it printed, while it runs.
  progress: string | null;
}

export interface JobDetail extends JobSummary {
  finished_epoch: number | null;
  exit_code: number | null;
  command: string;
  output: string;
}

export const job_tones: Record<JobState, Tone> = { running: "info", succeeded: "good", failed: "bad" };

// ── Badges ───────────────────────────────────────────────────────────────────

export function JobBadge({ state }: { state: JobState }) {
  return <ToneBadge tones={job_tones} state={state} />;
}

// ── Table ────────────────────────────────────────────────────────────────────

interface JobsTableProps<Job extends JobSummary> {
  jobs: Job[];
  // The job's own page.
  job_href: (job: Job) => string;
  // What the job is for, such as a host linked to its page; the column is left out unless set.
  owner?: (job: Job) => ReactNode;
  caption?: string;
}

export function JobsTable<Job extends JobSummary>({ jobs, job_href, owner, caption = "Jobs" }: JobsTableProps<Job>) {
  const columns: TableColumn<Job>[] = [
    { label: "Job", cell: (job) => <a href={job_href(job)}>{job.kind} #{job.id}</a>, text: (job) => `${job.kind} #${job.id}` },
    ...(owner === undefined ? [] : [{ label: "For", cell: owner }]),
    { label: "State", cell: (job) => <JobBadge state={job.state} />, text: (job) => job.state },
    { label: "Started", cell: (job) => <Age epoch={job.started_epoch} />, sort: (job) => job.started_epoch },
    { label: "By", cell: (job) => job.trigger },
    { label: "Last line", cell: (job) => <span className="muted small">{job.error ?? job.progress ?? ""}</span>, text: (job) => job.error ?? job.progress ?? "" },
  ];
  return <DataTable<Job> caption={caption} rows={jobs} row_key={(job) => String(job.id)} columns={columns} />;
}

// ── One job ──────────────────────────────────────────────────────────────────

interface JobDetailsProps {
  job: JobDetail;
  owner: ReactNode;
  // The app's own facts, after the shared ones.
  facts?: Fact[];
  // The command as shown, with its section's title; the job's command under "Command" unless set.
  command?: { title: string; text: string };
  // Shown between the error and the command, such as a build's progress.
  children?: ReactNode;
}

// One job's facts, its error, its command and its output, which keeps its newest lines in view while the job runs.
export function JobDetails({ job, owner, facts = [], command, children }: JobDetailsProps) {
  const running = job.state === "running";
  const shown = command ?? { title: "Command", text: job.command };
  return <>
    <Facts rows={[
      ["For", owner],
      ["State", <JobBadge state={job.state} />],
      ["Started", <Age epoch={job.started_epoch} />],
      ["Finished", <Age epoch={job.finished_epoch} />],
      ["Exit code", job.exit_code ?? "—"],
      ["Started by", job.trigger],
      ...facts,
    ]} />
    {job.error && <p className="tone-bad">{job.error}</p>}
    {children}
    <Section title={shown.title}><pre className="output">{shown.text}</pre></Section>
    <Section title="Output">
      {job.output
        ? <FollowingOutput text={job.output} active={running} toggle={running} class_name="run-output" />
        : <Empty title={running ? "Nothing printed yet." : "It printed nothing."} />}
    </Section>
  </>;
}

// A Stop button that asks first, in the words given, such as what stopping part-way leaves behind.
export function StopJobButton({ job_id, message, stop }: { job_id: number | string; message: ReactNode; stop: () => unknown }) {
  return (
    <button className="danger" onClick={() => confirm_dialog({ title: `Stop job ${job_id}`, message, confirm_label: "Stop", danger: true, run: async () => void (await stop()) })}>
      Stop
    </button>
  );
}
