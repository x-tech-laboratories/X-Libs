// An agent session's transcript as steps a page draws: thinking, the agent's text, each tool call with its input and
// result, permission requests and the user's own messages, folded from Claude Code's stream-json lines as they arrive,
// partial blocks merged as they end, and kept within a size so a finished session replays the same view. It runs alike
// in a daemon, a page and a phone, so the daemon can store it and every UI can draw it.

// ── Shapes ───────────────────────────────────────────────────────────────────

// Who a user message is from and why, such as "input" for what the session was started with or "message" for one written
// while it works; an app may add its own, such as answers to the agent's questions.
export type UserRole = string;

export type NoticeTone = "info" | "warn" | "bad";

interface Streamed {
  // The agent's message the block belongs to, and whether its whole message has arrived.
  message_id?: string;
  streaming?: boolean;
}

export interface ThinkingEntry extends Streamed {
  kind: "thinking";
  text: string;
}

export interface TextEntry extends Streamed {
  kind: "text";
  text: string;
}

export interface ToolEntry extends Streamed {
  kind: "tool";
  id: string;
  name: string;
  input: Record<string, unknown>;
  // The input as JSON while it is still being written.
  input_text?: string;
  // What the tool gave back, cut to a length; missing while it runs.
  result?: string;
  is_error?: boolean;
}

export interface UserEntry {
  kind: "user";
  role: UserRole;
  // The id the message was written with, which the stream echoes once the agent has read it.
  id: string;
  text: string;
  // Written to the session and not yet echoed back.
  pending?: boolean;
  at?: string;
}

export interface NoticeEntry {
  kind: "notice";
  tone: NoticeTone;
  text: string;
}

// A tool call the agent waits on the user to allow or refuse.
export interface PermissionEntry {
  kind: "permission";
  // The request's own id, which the answer names.
  id: string;
  tool: string;
  input: Record<string, unknown>;
  // The session's own words for why it asks, when it gives some.
  reason: string;
  // Missing while it waits.
  decision?: PermissionDecision;
  // The reason sent back with a refusal.
  message?: string;
}

// Allowed once, allowed for the rest of the session by `permission_rule`, or denied.
export type PermissionDecision = "allowed" | "allowed_for_session" | "denied";

export type TranscriptEntry = ThinkingEntry | TextEntry | ToolEntry | UserEntry | NoticeEntry | PermissionEntry;

// What the session is doing between its turns.
export type Activity = "working" | "paused" | "ended";

export interface Transcript {
  entries: TranscriptEntry[];
  // The model the session reports it runs on.
  model: string;
  // The permission mode the session runs in now.
  mode: string;
  activity: Activity;
  // How many of the earliest steps were left out to keep it within its size.
  dropped: number;
}

// The most of a transcript kept, as JSON characters; the earliest steps go first.
export const transcript_limit = 400_000;

// The most of one tool's result or one input field kept.
export const tool_text_limit = 8_000;

export function empty_transcript(): Transcript {
  return { entries: [], model: "", mode: "", activity: "working", dropped: 0 };
}

// A stored transcript, or an empty one when there is none or it is damaged.
export function read_transcript(text: string): Transcript {
  if (!text) return empty_transcript();
  try {
    const saved = JSON.parse(text) as Partial<Transcript>;
    return { ...empty_transcript(), ...saved, entries: Array.isArray(saved.entries) ? saved.entries : [] };
  } catch {
    return empty_transcript();
  }
}

// ── Reading the stream ───────────────────────────────────────────────────────

type Message = Record<string, unknown>;

function cut(text: string, limit = tool_text_limit): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… ${text.length - limit} more characters left out` : text;
}

// Long text fields of a tool's input cut to a length, so a large write does not fill the transcript.
function cut_input(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, value]) => [key, typeof value === "string" ? cut(value) : value]));
}

function result_text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part === "object" && (part as Message).type === "text" ? String((part as Message).text ?? "") : "")).join("\n");
  return "";
}

// The earliest entry of a message and kind whose whole message has not arrived yet, matched by tool id for tools.
function open_entry(transcript: Transcript, message_id: string, kind: "thinking" | "text" | "tool", tool_id: string): ThinkingEntry | TextEntry | ToolEntry | undefined {
  return transcript.entries.find((entry): entry is ThinkingEntry | TextEntry | ToolEntry => entry.kind === kind && entry.message_id === message_id && (kind !== "tool" || (entry as ToolEntry).id === tool_id));
}

function streaming_entry(transcript: Transcript, message_id: string): (ThinkingEntry | TextEntry | ToolEntry) | undefined {
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index]!;
    if ((entry.kind === "thinking" || entry.kind === "text" || entry.kind === "tool") && entry.message_id === message_id && entry.streaming) return entry;
  }
  return undefined;
}

function read_partial(transcript: Transcript, message: Message): boolean {
  const event = (message.event ?? {}) as Message;
  const message_id = String(message.api_message_id ?? "");
  if (event.type === "content_block_start") {
    const block = (event.content_block ?? {}) as Message;
    if (block.type === "thinking") transcript.entries.push({ kind: "thinking", text: String(block.thinking ?? ""), message_id, streaming: true });
    else if (block.type === "text") transcript.entries.push({ kind: "text", text: String(block.text ?? ""), message_id, streaming: true });
    else if (block.type === "tool_use") transcript.entries.push({ kind: "tool", id: String(block.id ?? ""), name: String(block.name ?? ""), input: {}, input_text: "", message_id, streaming: true });
    else return false;
    return true;
  }
  if (event.type === "content_block_delta") {
    const entry = streaming_entry(transcript, message_id);
    const delta = (event.delta ?? {}) as Message;
    if (!entry) return false;
    if (entry.kind === "thinking" && delta.type === "thinking_delta") entry.text += String(delta.thinking ?? "");
    else if (entry.kind === "text" && delta.type === "text_delta") entry.text += String(delta.text ?? "");
    else if (entry.kind === "tool" && delta.type === "input_json_delta") entry.input_text = `${entry.input_text ?? ""}${String(delta.partial_json ?? "")}`;
    else return false;
    return true;
  }
  if (event.type === "content_block_stop") {
    const entry = streaming_entry(transcript, message_id);
    if (!entry) return false;
    entry.streaming = false;
    if (entry.kind === "tool" && entry.input_text) {
      try {
        entry.input = cut_input(JSON.parse(entry.input_text));
      } catch {
        // The whole message brings the input again.
      }
    }
    if (entry.kind === "tool") delete entry.input_text;
    return true;
  }
  return false;
}

function read_assistant(transcript: Transcript, message: Message): boolean {
  const body = (message.message ?? {}) as Message;
  const message_id = String(body.id ?? "");
  const content = Array.isArray(body.content) ? (body.content as Message[]) : [];
  let changed = false;
  for (const part of content) {
    if (part.type !== "thinking" && part.type !== "text" && part.type !== "tool_use") continue;
    const kind = part.type === "tool_use" ? "tool" : part.type;
    const found = message_id ? open_entry(transcript, message_id, kind, String(part.id ?? "")) : undefined;
    const text = String((part.type === "thinking" ? part.thinking : part.text) ?? "");
    if (found?.kind === "tool") {
      found.input = cut_input(part.input);
      delete found.input_text;
    } else if (found && (found.kind === "text" || found.kind === "thinking")) {
      if (text) found.text = text;
    } else if (kind === "tool") {
      transcript.entries.push({ kind: "tool", id: String(part.id ?? ""), name: String(part.name ?? ""), input: cut_input(part.input), streaming: false });
    } else {
      transcript.entries.push({ kind, text, streaming: false } as ThinkingEntry | TextEntry);
    }
    // A whole block is no longer matched by its message.
    if (found) {
      found.streaming = false;
      delete found.message_id;
    }
    changed = true;
  }
  return changed;
}

function read_user(transcript: Transcript, message: Message): boolean {
  const body = (message.message ?? {}) as Message;
  const content = typeof body.content === "string" ? [{ type: "text", text: body.content }] : Array.isArray(body.content) ? (body.content as Message[]) : [];
  let changed = false;
  for (const part of content) {
    if (part.type === "tool_result") {
      const tool = transcript.entries.find((entry): entry is ToolEntry => entry.kind === "tool" && entry.id === part.tool_use_id);
      if (!tool) continue;
      tool.result = cut(result_text(part.content));
      tool.is_error = part.is_error === true;
      changed = true;
    }
  }
  const text = content.filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("\n");
  if (!text) return changed;
  const own = transcript.entries.find((entry): entry is UserEntry => entry.kind === "user" && entry.id === message.uuid);
  if (own) {
    if (own.pending) {
      own.pending = false;
      return true;
    }
    return changed;
  }
  if (text.startsWith("[Request interrupted")) {
    transcript.entries.push({ kind: "notice", tone: "warn", text: "Interrupted. The session waits for your message." });
    return true;
  }
  return changed;
}

function read_result(transcript: Transcript, message: Message): boolean {
  const reason = String(message.terminal_reason ?? "");
  if (message.is_error !== true || reason.startsWith("aborted")) return false;
  transcript.entries.push({ kind: "notice", tone: "bad", text: String(message.result ?? "") || `The turn ended with an error (${String(message.subtype ?? "unknown")}).` });
  return true;
}

// Folds one parsed stream-json line into the transcript and says whether anything shown changed.
export function fold_stream_message(transcript: Transcript, message: Message): boolean {
  if (message.type === "stream_event") return read_partial(transcript, message);
  if (message.type === "assistant") return read_assistant(transcript, message);
  if (message.type === "user") return read_user(transcript, message);
  if (message.type === "result") return read_result(transcript, message);
  if (message.type === "system" && message.subtype === "init") {
    transcript.model = String(message.model ?? transcript.model);
    transcript.mode = String(message.permissionMode ?? transcript.mode);
    return true;
  }
  return false;
}

// ── Writing ──────────────────────────────────────────────────────────────────

// A permission request added to wait for the user, its long input fields cut.
export function add_permission(transcript: Transcript, request: { id: string; tool: string; input: unknown; reason: string }): PermissionEntry {
  const entry: PermissionEntry = { kind: "permission", id: request.id, tool: request.tool, input: cut_input(request.input), reason: request.reason };
  transcript.entries.push(entry);
  return entry;
}

// A message from the user added as pending until the stream echoes it.
export function add_user_message(transcript: Transcript, role: UserRole, id: string, text: string, at?: string): void {
  transcript.entries.push({ kind: "user", role, id, text: cut(text, transcript_limit / 4), pending: true, ...(at ? { at } : {}) });
}

// The transcript as it is stored: streaming blocks marked whole, the earliest steps dropped past the size limit.
export function stored_transcript(transcript: Transcript, limit = transcript_limit): string {
  let text = JSON.stringify(transcript);
  while (text.length > limit && transcript.entries.length > 1) {
    // The starting input stays first, so the reader still sees what the session was given.
    const first_kept = transcript.entries[0]?.kind === "user" && transcript.entries[0].role === "input" ? 1 : 0;
    const drop = Math.max(1, Math.ceil((transcript.entries.length - first_kept) / 10));
    transcript.entries.splice(first_kept, drop);
    transcript.dropped += drop;
    text = JSON.stringify(transcript);
  }
  return text;
}

// Every block still streaming marked whole and every waiting request denied, as when the session ended part-way.
export function close_open_blocks(transcript: Transcript): void {
  for (const entry of transcript.entries) {
    if ((entry.kind === "thinking" || entry.kind === "text" || entry.kind === "tool") && entry.streaming) entry.streaming = false;
    if (entry.kind === "permission" && !entry.decision) Object.assign(entry, { decision: "denied", message: "The session ended first." });
  }
}

// ── Describing ───────────────────────────────────────────────────────────────

const summary_limit = 160;

// One line saying what a tool call works on: its file, command, pattern, address or description.
export function tool_summary(input: Record<string, unknown>): string {
  const main = input.file_path ?? input.notebook_path ?? input.command ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt ?? "";
  const text = String(typeof main === "string" ? main : JSON.stringify(main)).replace(/\s+/g, " ").trim();
  return text.length > summary_limit ? `${text.slice(0, summary_limit)}…` : text;
}

export interface EditChange {
  path: string;
  // The text before and after; empty before for a new file.
  before: string;
  after: string;
}

// The change a file-editing tool call makes, read from its input, or null for any other tool.
export function edit_of(name: string, input: Record<string, unknown>): EditChange[] | null {
  const path = String(input.file_path ?? input.notebook_path ?? "");
  if (name === "Edit") return [{ path, before: String(input.old_string ?? ""), after: String(input.new_string ?? "") }];
  if (name === "Write") return [{ path, before: "", after: String(input.content ?? "") }];
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return (input.edits as Record<string, unknown>[]).map((edit) => ({ path, before: String(edit.old_string ?? ""), after: String(edit.new_string ?? "") }));
  }
  return null;
}

// The entries a user message is waiting on, so the page can show it as not yet read.
export function pending_messages(transcript: Transcript): UserEntry[] {
  return transcript.entries.filter((entry): entry is UserEntry => entry.kind === "user" && entry.pending === true);
}

// The permission requests still waiting on the user.
export function waiting_permissions(transcript: Transcript): PermissionEntry[] {
  return transcript.entries.filter((entry): entry is PermissionEntry => entry.kind === "permission" && !entry.decision);
}

// ── Allowing for the session ─────────────────────────────────────────────────

// What allowing a tool for the rest of the session covers: the tool, and for a command the program it starts.
export function permission_rule(tool: string, input: Record<string, unknown>): string {
  if (tool !== "Bash" || typeof input.command !== "string") return tool;
  const program = input.command.trim().split(/\s+/)[0] ?? "";
  return program ? `Bash(${program})` : tool;
}

// Whether a rule covers a tool call, such as Bash(git) covering every git command.
export function rule_covers(rule: string, tool: string, input: Record<string, unknown>): boolean {
  return rule === tool || rule === permission_rule(tool, input);
}

// The rule in words for the button that sets it, such as "git commands".
export function rule_words(rule: string): string {
  const program = /^Bash\((.+)\)$/.exec(rule)?.[1];
  return program ? `${program} commands` : rule;
}
