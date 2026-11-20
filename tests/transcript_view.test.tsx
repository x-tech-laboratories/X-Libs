// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TranscriptEntry } from "../src/agent_transcript.ts";
import { TranscriptMessageBox, TranscriptView } from "../src/web/react/transcript.tsx";

afterEach(cleanup);

const entries: TranscriptEntry[] = [
  { kind: "user", role: "input", id: "u0", text: "Plan the **change**." },
  { kind: "thinking", text: "First look.\nThen act.", streaming: false },
  { kind: "text", text: "I will edit a file." },
  { kind: "tool", id: "t1", name: "Edit", input: { file_path: "a.ts", old_string: "one", new_string: "two" }, result: "Done" },
  { kind: "tool", id: "t2", name: "Bash", input: { command: "npm test" }, result: "boom", is_error: true },
  { kind: "tool", id: "t3", name: "Grep", input: { pattern: "TODO" } },
  { kind: "user", role: "message", id: "u1", text: "Go faster.", pending: true },
  { kind: "notice", tone: "warn", text: "Interrupted." },
];

describe("a transcript", () => {
  it("shows each step: the input folded, thinking, text, tool calls with edits as diffs, failures and messages not yet read", () => {
    render(<TranscriptView entries={entries} live user_labels={{ input: "What it was given" }} />);
    const log = screen.getByRole("log", { name: "Transcript" });

    expect(within(log).getByText("What it was given")).toBeTruthy();
    expect(within(log).getByText("Then act.")).toBeTruthy();
    expect(within(log).getByText("I will edit a file.")).toBeTruthy();
    expect(within(log).getByRole("table", { name: "Change to a.ts" })).toBeTruthy();
    expect(within(log).getByText("failed")).toBeTruthy();
    expect(within(log).getByText("boom")).toBeTruthy();
    expect(within(log).getAllByRole("status", { name: "Running" })).toHaveLength(1);
    expect(within(log).getByText("Not read yet")).toBeTruthy();
    expect(within(log).getByText("Interrupted.")).toBeTruthy();
    expect(log.getAttribute("aria-live")).toBe("polite");
  });

  it("says when it is empty and when early steps were left out, and shows no running mark once done", () => {
    render(<TranscriptView entries={[]} live={false} empty_text="Not started." />);
    expect(screen.getByText("Not started.")).toBeTruthy();
    cleanup();

    render(<TranscriptView entries={entries} live={false} dropped={4} />);
    expect(screen.getByText("4 earlier steps were left out to keep the transcript within its size.")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Running" })).toBeNull();
    expect(screen.getByText("Input")).toBeTruthy();
  });

  it("asks about a waiting tool call and sends the answer with a reason for a refusal", () => {
    const on_permission = vi.fn();
    const waiting: TranscriptEntry = { kind: "permission", id: "p1", tool: "Bash", input: { command: "git push" }, reason: "It reaches the network." };
    render(<TranscriptView entries={[waiting]} live on_permission={on_permission} permission_words={{ allow_for_session: (rule) => `Allow ${rule} for This Run` }} />);
    const group = screen.getByRole("group", { name: "Bash waits for approval" });

    expect(within(group).getByText("It reaches the network.")).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: "Allow" }));
    fireEvent.click(within(group).getByRole("button", { name: "Allow git commands for This Run" }));
    fireEvent.change(within(group).getByRole("textbox", { name: "Why Bash is refused" }), { target: { value: "Not yet." } });
    fireEvent.click(within(group).getByRole("button", { name: "Deny" }));

    expect(on_permission.mock.calls).toEqual([
      ["p1", "allowed", ""],
      ["p1", "allowed_for_session", ""],
      ["p1", "denied", "Not yet."],
    ]);
  });

  it("shows a decided request with its decision and reason, and a waiting one without buttons when it cannot be answered", () => {
    const decided: TranscriptEntry = { kind: "permission", id: "p2", tool: "Write", input: { file_path: "b.ts" }, reason: "", decision: "denied", message: "No." };
    const waiting: TranscriptEntry = { kind: "permission", id: "p3", tool: "Edit", input: { file_path: "c.ts", old_string: "a", new_string: "b" }, reason: "" };
    render(<TranscriptView entries={[decided, waiting]} live={false} allow_for_session={false} on_permission={vi.fn()} />);

    expect(screen.getByText("Denied")).toBeTruthy();
    expect(screen.getByText("Reason given: No.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.getByRole("table", { name: "Change to c.ts" })).toBeTruthy();
  });

  it("shows a tool's input while it is still being written, and plain JSON for an input with no command", () => {
    render(<TranscriptView entries={[{ kind: "tool", id: "t4", name: "Task", input: {}, input_text: '{"desc' }, { kind: "tool", id: "t5", name: "Fetch", input: { headers: { a: 1 } }, result: "" }]} live />);

    expect(screen.getByText('{"desc')).toBeTruthy();
    expect(screen.getByText("No output.")).toBeTruthy();
    expect(screen.getByText(/"headers"/)).toBeTruthy();
  });

  it("offers a way back to the latest step once the reader scrolls up", async () => {
    render(<TranscriptView entries={entries} live />);
    const log = screen.getByRole("log", { name: "Transcript" });
    Object.defineProperties(log, { scrollHeight: { value: 2000, configurable: true }, clientHeight: { value: 200, configurable: true } });

    log.scrollTop = 100;
    fireEvent.scroll(log);
    const jump = await screen.findByRole("button", { name: "Jump to Latest" });
    fireEvent.click(jump);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Jump to Latest" })).toBeNull());
  });
});

describe("the message box", () => {
  it("sends by its button or Ctrl+Enter and empties once sent, keeping the text when sending fails", async () => {
    const on_send = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<TranscriptMessageBox on_send={on_send} />);
    const box = screen.getByRole("textbox", { name: "Message to the agent" }) as HTMLTextAreaElement;

    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Use the cache." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(box.value).toBe(""));

    fireEvent.change(box, { target: { value: "Again." } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(on_send).toHaveBeenCalledTimes(2));
    expect(on_send).toHaveBeenLastCalledWith("Again.");
    expect(box.value).toBe("Again.");
  });
});
