// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToneBadge, type Tone } from "../src/web/react/badges.tsx";
import { Dialogs } from "../src/web/react/dialog.tsx";
import { EventsList, LevelBadge } from "../src/web/react/events_list.tsx";
import { JobDetails, JobsTable, StopJobButton, type JobDetail } from "../src/web/react/jobs.tsx";

afterEach(cleanup);

const now = Math.floor(Date.now() / 1000);

const job: JobDetail = {
  id: 7, kind: "build", state: "running", started_epoch: now - 60, trigger: "schedule", error: null, progress: "building foo",
  finished_epoch: null, exit_code: null, command: "nix build", output: "",
};

// ── Badges ───────────────────────────────────────────────────────────────────

describe("badges", () => {
  it("show a state's own name in its tone", () => {
    const tones: Record<"queued" | "stopped", Tone> = { queued: "none", stopped: "warn" };
    render(<ToneBadge tones={tones} state="stopped" />);

    expect(screen.getByText("stopped").className).toBe("badge tone-warn");
  });

  it("show an event level in any case, and an unknown one as it is", () => {
    render(<><LevelBadge level="WARNING" /><LevelBadge level="debug" /></>);

    expect(screen.getByText("warning").className).toBe("badge tone-warn");
    expect(screen.getByText("debug").className).toBe("badge tone-none");
  });
});

// ── Events ───────────────────────────────────────────────────────────────────

describe("events list", () => {
  it("shows each event's age, level, the app's own part and message", () => {
    render(<EventsList events={[{ epoch: now - 120, level: "error", message: "Disk full", host: "odin" }]} extra={(event) => <a href="#odin">{event.host}</a>} />);

    const row = screen.getByRole("listitem");
    expect(row.textContent).toBe("2m agoerrorodinDisk full");
    expect(screen.getByRole("link", { name: "odin" })).toBeTruthy();
  });

  it("leaves out the time of an entry without one and says when there is nothing", () => {
    const { rerender } = render(<EventsList events={[{ level: "info", message: "Read" }]} />);
    expect(screen.getByRole("listitem").textContent).toBe("infoRead");

    rerender(<EventsList events={[]} empty="No events yet." />);
    expect(screen.getByText("No events yet.")).toBeTruthy();
  });
});

// ── Jobs ─────────────────────────────────────────────────────────────────────

describe("jobs", () => {
  it("lists jobs linked to their pages, with what each is for when asked", () => {
    render(<JobsTable jobs={[job]} job_href={(row) => `#jobs/${row.id}`} owner={() => <a href="#hosts/odin">odin</a>} />);

    expect(screen.getByRole("link", { name: "build #7" }).getAttribute("href")).toBe("#jobs/7");
    expect(screen.getByRole("link", { name: "odin" })).toBeTruthy();
    expect(screen.getByText("building foo")).toBeTruthy();
  });

  it("leaves out the For column unless asked", () => {
    render(<JobsTable jobs={[job]} job_href={() => "#"} />);

    expect(screen.queryByRole("columnheader", { name: /For/ })).toBeNull();
  });

  it("shows one job's facts, the app's own, its command and its output", () => {
    const done = { ...job, state: "failed" as const, exit_code: 1, error: "It broke", output: "line one\n" };
    render(<JobDetails job={done} owner="odin" facts={[["Runs on", "thor"]]} command={{ title: "Operation", text: "{}" }}><p>progress here</p></JobDetails>);

    expect(screen.getByText("thor")).toBeTruthy();
    expect(screen.getByText("It broke")).toBeTruthy();
    expect(screen.getByText("progress here")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Operation" })).toBeTruthy();
    expect(screen.getByText("line one")).toBeTruthy();
  });

  it("says when a running job has printed nothing yet", () => {
    render(<JobDetails job={job} owner="odin" />);

    expect(screen.getByRole("heading", { name: "Command" })).toBeTruthy();
    expect(screen.getByText("Nothing printed yet.")).toBeTruthy();
  });

  it("stops a job only once the dialog is confirmed", async () => {
    const stop = vi.fn(async () => {});
    render(<><Dialogs /><StopJobButton job_id={7} message="Stop it?" stop={stop} /></>);

    act(() => void fireEvent.click(screen.getByRole("button", { name: "Stop" })));
    expect(stop).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop" })));

    expect(stop).toHaveBeenCalledOnce();
  });
});
