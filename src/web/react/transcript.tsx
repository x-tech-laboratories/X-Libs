// An agent session's transcript from `agent_transcript` as steps: thinking folded to one line, its text as Markdown,
// each tool call as a row naming the tool and what it works on that opens to its whole input and result, an edit as a
// small diff, the user's own messages in place, marked while the agent has not read them yet, and each tool call
// waiting for approval with Allow, Allow for the session and Deny. It follows the newest step until the reader scrolls
// up, with a button back to the latest. `TranscriptMessageBox` writes to the agent while its session is open.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useState } from "react";

import { edit_of, permission_rule, rule_words, tool_summary, type PermissionDecision, type PermissionEntry, type ThinkingEntry, type ToolEntry, type TranscriptEntry, type UserEntry, type UserRole } from "../../agent_transcript.ts";
import { cx } from "../dom.ts";
import { Badge } from "./badges.tsx";
import { EditDiff } from "./diff.tsx";
import { use_follow_tail } from "./following.tsx";
import { Markdown } from "./markdown.tsx";

// ── Steps ────────────────────────────────────────────────────────────────────

const default_user_labels: Record<UserRole, string> = { input: "Input", message: "You" };

function last_line(text: string): string {
  return text.trim().split("\n").at(-1)?.trim() ?? "";
}

function Thinking({ entry }: { entry: ThinkingEntry }) {
  return (
    <details className="transcript-step transcript-thinking">
      <summary>
        <span className={cx("status-dot", "tone-info", entry.streaming && "busy")} aria-hidden="true" /> <span className="muted">{entry.streaming ? "Thinking…" : "Thought"}</span> <span className="transcript-line muted small">{last_line(entry.text)}</span>
      </summary>
      <p className="transcript-text muted">{entry.text || "The model kept its thinking to itself."}</p>
    </details>
  );
}

function ToolInput({ name, input, input_text }: { name: string; input: Record<string, unknown>; input_text?: string }) {
  if (input_text !== undefined) return <pre className="transcript-code">{input_text}</pre>;
  const edits = edit_of(name, input);
  if (edits) return <>{edits.map((edit, index) => <EditDiff key={index} {...edit} />)}</>;
  if (typeof input.command === "string") return <pre className="transcript-code">{input.command}</pre>;
  return <pre className="transcript-code">{JSON.stringify(input, null, 2)}</pre>;
}

export type AnswerPermission = (id: string, decision: PermissionDecision, message: string) => void;

interface PermissionWords {
  decisions: Record<PermissionDecision, string>;
  // The button that allows the tool for the rest of the session, given the rule in words such as "git commands".
  allow_for_session: (rule: string) => string;
}

const default_permission_words: PermissionWords = {
  decisions: { allowed: "Allowed", allowed_for_session: "Allowed for this session", denied: "Denied" },
  allow_for_session: (rule) => `Allow ${rule} for This Session`,
};

function Permission({ entry, on_answer, allow_for_session, words }: { entry: PermissionEntry; on_answer?: AnswerPermission; allow_for_session: boolean; words: PermissionWords }) {
  const [reason, set_reason] = useState("");
  const waiting = !entry.decision;
  const tone = waiting ? "warn" : entry.decision === "denied" ? "bad" : "good";
  return (
    <div className={cx("transcript-step transcript-permission", `tone-edge-${tone}`)} role={waiting ? "group" : undefined} aria-label={waiting ? `${entry.tool} waits for approval` : undefined}>
      <div className="transcript-head">
        <Badge tone={tone}>{waiting ? "Waiting for approval" : words.decisions[entry.decision!]}</Badge>
        <strong>{entry.tool}</strong>
        {!waiting && <code className="transcript-line">{tool_summary(entry.input)}</code>}
      </div>
      {entry.reason && <p className="small muted">{entry.reason}</p>}
      {waiting && <ToolInput name={entry.tool} input={entry.input} />}
      {entry.message && <p className="small">Reason given: {entry.message}</p>}
      {waiting && on_answer && (
        <div className="transcript-answer">
          <input type="text" aria-label={`Why ${entry.tool} is refused`} placeholder="Why not, for the agent (optional)" value={reason} onChange={(event) => set_reason(event.currentTarget.value)} />
          <span className="transcript-head">
            <button type="button" className="accent solid" onClick={() => on_answer(entry.id, "allowed", "")}>
              Allow
            </button>
            {allow_for_session && (
              <button type="button" onClick={() => on_answer(entry.id, "allowed_for_session", "")}>
                {words.allow_for_session(rule_words(permission_rule(entry.tool, entry.input)))}
              </button>
            )}
            <button type="button" className="danger" onClick={() => on_answer(entry.id, "denied", reason)}>
              Deny
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function Tool({ entry, live }: { entry: ToolEntry; live: boolean }) {
  const running = entry.result === undefined && live;
  return (
    <details className={cx("transcript-step transcript-tool", entry.is_error && "failed tone-edge-bad")}>
      <summary>
        <Badge tone={entry.is_error ? "bad" : "none"}>{entry.name}</Badge>
        {running && <span className="status-dot tone-info busy" role="status" aria-label="Running" />}
        <code className="transcript-line">{tool_summary(entry.input) || (entry.input_text ? "…" : "")}</code>
        {entry.is_error && <span className="tone-bad small">failed</span>}
      </summary>
      <ToolInput name={entry.name} input={entry.input} input_text={entry.input_text} />
      {entry.result !== undefined && <pre className={cx("transcript-code", entry.is_error && "failed")}>{entry.result || "No output."}</pre>}
    </details>
  );
}

function UserMessage({ entry, labels }: { entry: UserEntry; labels: Record<UserRole, string> }) {
  const label = labels[entry.role] ?? entry.role;
  if (entry.role === "input") {
    return (
      <details className="transcript-step">
        <summary className="muted">{label}</summary>
        <Markdown text={entry.text} />
      </details>
    );
  }
  return (
    <div className="transcript-step transcript-user">
      <div className="small muted">
        {label} {entry.pending && <Badge tone="warn">Not read yet</Badge>}
      </div>
      <p className="transcript-text">{entry.text}</p>
    </div>
  );
}

interface StepProps {
  entry: TranscriptEntry;
  live: boolean;
  labels: Record<UserRole, string>;
  on_permission?: AnswerPermission;
  allow_for_session: boolean;
  words: PermissionWords;
}

function Step({ entry, live, labels, on_permission, allow_for_session, words }: StepProps) {
  if (entry.kind === "thinking") return <Thinking entry={entry} />;
  if (entry.kind === "text") return <Markdown text={entry.text} class_name="transcript-step" />;
  if (entry.kind === "tool") return <Tool entry={entry} live={live} />;
  if (entry.kind === "user") return <UserMessage entry={entry} labels={labels} />;
  if (entry.kind === "permission") return <Permission entry={entry} on_answer={live ? on_permission : undefined} allow_for_session={allow_for_session} words={words} />;
  return <p className={cx("transcript-step transcript-notice small", `tone-${entry.tone}`)}>{entry.text}</p>;
}

// ── View ─────────────────────────────────────────────────────────────────────

interface TranscriptViewProps {
  entries: TranscriptEntry[];
  // Whether steps are still arriving, which keeps the newest in view and marks tool calls without a result as running.
  live: boolean;
  // How many of the earliest steps were left out.
  dropped?: number;
  empty_text?: string;
  // The words above each kind of message from the user, by role.
  user_labels?: Partial<Record<UserRole, string>>;
  // Answers a tool call waiting for approval; left out, waiting calls show without buttons.
  on_permission?: AnswerPermission;
  // Whether a tool can be allowed for the rest of the session from here, rather than one call at a time.
  allow_for_session?: boolean;
  // The decisions' words and the allow-for-the-session button's, such as "Allow git commands for This Run".
  permission_words?: Partial<PermissionWords>;
}

export function TranscriptView({ entries, live, dropped = 0, empty_text = "Nothing yet.", user_labels, on_permission, allow_for_session = true, permission_words }: TranscriptViewProps) {
  const last = entries.at(-1);
  const size = `${entries.length} ${last && "text" in last ? last.text.length : 0} ${last?.kind === "tool" ? `${last.input_text?.length ?? 0} ${last.result?.length ?? 0}` : ""}`;
  const follow = use_follow_tail<HTMLDivElement>(size, live);
  const labels = { ...default_user_labels, ...user_labels } as Record<UserRole, string>;
  const words = { ...default_permission_words, ...permission_words };
  return (
    <div className="transcript-frame">
      <div ref={follow.ref} className="transcript" role="log" aria-label="Transcript" aria-live={live ? "polite" : "off"} onScroll={follow.on_scroll}>
        {dropped > 0 && <p className="muted small">{dropped} earlier steps were left out to keep the transcript within its size.</p>}
        {entries.length === 0 ? <p className="muted">{empty_text}</p> : entries.map((entry, index) => <Step key={index} entry={entry} live={live} labels={labels} on_permission={on_permission} allow_for_session={allow_for_session} words={words} />)}
      </div>
      {live && !follow.following && (
        <button type="button" className="transcript-jump" onClick={() => follow.set_following(true)}>
          Jump to Latest
        </button>
      )}
    </div>
  );
}

// ── Message box ──────────────────────────────────────────────────────────────

interface TranscriptMessageBoxProps {
  // Sends the text and says whether it went, after which the box empties.
  on_send: (text: string) => Promise<boolean> | boolean;
  placeholder?: string;
  label?: string;
}

// A box to write to the agent, sent by its button or Ctrl+Enter.
export function TranscriptMessageBox({ on_send, placeholder = "Steer the agent; it reads this after its current step", label = "Message to the agent" }: TranscriptMessageBoxProps) {
  const [text, set_text] = useState("");
  const [sending, set_sending] = useState(false);
  async function send(): Promise<void> {
    if (!text.trim() || sending) return;
    set_sending(true);
    try {
      if (await on_send(text)) set_text("");
    } finally {
      set_sending(false);
    }
  }
  return (
    <form
      className="transcript-message"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        aria-label={label}
        rows={2}
        placeholder={placeholder}
        value={text}
        onChange={(event) => set_text(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <button type="submit" className="accent solid" disabled={!text.trim() || sending}>
        Send
      </button>
    </form>
  );
}
