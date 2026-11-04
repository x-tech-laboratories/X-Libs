// The messages the server and a host's agent exchange over the agent's WebSocket, shared by both sides.
//
// Every message but a stream's output is one JSON text frame with a `type`. A request from the server carries an `id`
// the agent answers with one `reply` or `failed` of the same id. A stream or an attach sends its output as binary
// frames tagged with its id, only as far as the credit the server has granted, then one `stream_end`. Either side
// sends `ping` while idle and drops a connection that has been silent too long.
//
// A run, a long run and a stream each carry the app's task: a shell command for one app, a typed operation for another.
// The app names the field its task travels in and checks it, so each app keeps its own wire format and version.
//
// An agent logging in with its host's key, rather than a token, names the host in the upgrade; the server's first
// message is then a `challenge`, and the agent's hello carries its signature of that nonce (see keys.ts).
//
// An app adds its own messages beside these: any other `type` is handed to the app, and one carrying a string `id` is
// a request the app's handler answers like any other.

// ── App ──────────────────────────────────────────────────────────────────────

// What an app's server and agents agree on, given to both sides.
export interface AgentApp<Task> {
  // The app's name, such as "x-nix", which names the key login's header and is bound into its signature.
  name: string;
  // The app's own protocol version; a hello with another is turned away.
  protocol_version: number;
  // The field a task travels in on the wire, such as "command" or "operation".
  task_field: string;
  is_task(value: unknown): value is Task;
}

// An app whose tasks are shell command lines, sent in a `command` field.
export function shell_app(name: string, protocol_version = 1): AgentApp<string> {
  return { name, protocol_version, task_field: "command", is_task: (value): value is string => typeof value === "string" };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface RunResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export type LongRunState = "running" | "exited" | "stopped" | "lost";

// A task the agent keeps going on its own, which outlives the connection and the agent.
export interface LongRun {
  run_id: string;
  pid: number;
  started_epoch: number;
  // Lost means it ended with no exit code written, as when the host rebooted under it.
  state: LongRunState;
  exit_code: number | null;
}

// What a long run has written since an offset, and whether it is still going.
export interface LongRunPoll {
  state: LongRunState;
  exit_code: number | null;
  alive: boolean;
  // The size of its whole output in bytes.
  size: number;
  new_output: string;
  // Where the next poll starts, which is short of `size` when a poll returns only part of the output.
  next_offset: number;
}

// A message of the app's own, which the protocol passes along without checking its fields.
export interface AppMessage {
  type: string;
  [field: string]: unknown;
}

// ── Server to agent ──────────────────────────────────────────────────────────

// Each request the server makes and what its reply carries.
export interface Requests<Task> {
  run: { body: { task: Task; stdin: string | null; timeout_in_seconds: number }; reply: RunResult };
  start: { body: { run_id: string; task: Task; stdin: string | null }; reply: LongRun };
  poll: { body: { run_id: string; offset: number }; reply: LongRunPoll };
  stop: { body: { run_id: string }; reply: LongRun };
  forget: { body: { run_id: string }; reply: null };
  runs: { body: Record<never, never>; reply: LongRun[] };
}

export type RequestType = keyof Requests<unknown>;

export type RequestMessage<Task> = {
  [K in RequestType]: { type: K; id: string } & Requests<Task>[K]["body"];
}[RequestType];

export type ServerMessage<Task> =
  | RequestMessage<Task>
  // Performs a task and sends its stdout as it comes, `window` bytes ahead of the credit that follows.
  | { type: "stream"; id: string; task: Task; stdin: string | null; window: number }
  // Follows a long run's output from an offset until it ends, as a stream does.
  | { type: "attach"; id: string; run_id: string; offset: number; window: number }
  | { type: "credit"; id: string; bytes: number }
  // Stops a stream or an attach; the agent still ends it with a stream_end.
  | { type: "cancel"; id: string }
  | { type: "ping"; epoch_ms: number }
  | { type: "pong"; epoch_ms: number }
  // Sent first to an agent logging in with its key, which signs the nonce in its hello.
  | { type: "challenge"; nonce: string };

// ── Agent to server ──────────────────────────────────────────────────────────

export type AgentMessage =
  // An agent logging in with its key adds its signature of the challenge.
  | { type: "hello"; protocol: number; host: string; agent_version: string; runs: LongRun[]; signature?: string }
  | { type: "reply"; id: string; value: unknown }
  | { type: "failed"; id: string; error: string }
  | { type: "stream_end"; id: string; exit_code: number; stderr: string }
  | { type: "ping"; epoch_ms: number }
  | { type: "pong"; epoch_ms: number };

// ── Checking ─────────────────────────────────────────────────────────────────

type FieldKind = "string" | "number" | "string_or_null" | "array" | "task" | "any";

const id_fields = { id: "string" } as const;
const run_fields = { ...id_fields, run_id: "string" } as const;

const server_fields: Record<ServerMessage<unknown>["type"], Record<string, FieldKind>> = {
  run: { ...id_fields, task: "task", stdin: "string_or_null", timeout_in_seconds: "number" },
  start: { ...run_fields, task: "task", stdin: "string_or_null" },
  poll: { ...run_fields, offset: "number" },
  stop: run_fields,
  forget: run_fields,
  runs: id_fields,
  stream: { ...id_fields, task: "task", stdin: "string_or_null", window: "number" },
  attach: { ...run_fields, offset: "number", window: "number" },
  credit: { ...id_fields, bytes: "number" },
  cancel: id_fields,
  ping: { epoch_ms: "number" },
  pong: { epoch_ms: "number" },
  challenge: { nonce: "string" },
};

const agent_fields: Record<AgentMessage["type"], Record<string, FieldKind>> = {
  hello: { protocol: "number", host: "string", agent_version: "string", runs: "array" },
  reply: { ...id_fields, value: "any" },
  failed: { ...id_fields, error: "string" },
  stream_end: { ...id_fields, exit_code: "number", stderr: "string" },
  ping: { epoch_ms: "number" },
  pong: { epoch_ms: "number" },
};

function has_kind(value: unknown, kind: FieldKind, app: AgentApp<unknown>): boolean {
  if (kind === "any") return value !== undefined;
  if (kind === "task") return app.is_task(value);
  if (kind === "array") return Array.isArray(value);
  if (kind === "string_or_null") return value === null || typeof value === "string";
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === kind;
}

// A known message with every field it needs, an app's message for any other type, or null for one that is neither.
function parse_with<Known>(text: string, fields: Record<string, Record<string, FieldKind>>, app: AgentApp<unknown>): Known | AppMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
  const record = message as Record<string, unknown>;
  if (typeof record.type !== "string" || record.type === "") return null;
  if (!Object.hasOwn(fields, record.type)) return record as AppMessage;
  // The task arrives in the app's own field and is read as `task`.
  const known_fields = fields[record.type];
  if (Object.hasOwn(known_fields, "task") && app.task_field !== "task") {
    record.task = record[app.task_field];
    delete record[app.task_field];
  }
  for (const [name, kind] of Object.entries(known_fields)) {
    if (!has_kind(record[name], kind, app)) return null;
  }
  return message as Known;
}

// A message from the server, or null for one that is not a message at all.
export function parse_server_message<Task>(text: string, app: AgentApp<Task>): ServerMessage<Task> | AppMessage | null {
  return parse_with<ServerMessage<Task>>(text, server_fields, app);
}

// A message from an agent, or null for one that is not a message at all.
export function parse_agent_message(text: string, app: AgentApp<unknown>): AgentMessage | AppMessage | null {
  return parse_with<AgentMessage>(text, agent_fields, app);
}

// Whether a parsed message is one of this protocol's own rather than the app's.
export function is_server_message<Task>(message: ServerMessage<Task> | AppMessage): message is ServerMessage<Task> {
  return Object.hasOwn(server_fields, message.type);
}

export function is_agent_message(message: AgentMessage | AppMessage): message is AgentMessage {
  return Object.hasOwn(agent_fields, message.type);
}

// The message as one text frame, with any task in the app's own field.
export function encode_message<Task>(message: ServerMessage<Task> | AgentMessage | AppMessage, app: AgentApp<Task>): string {
  if (!Object.hasOwn(server_fields, message.type) || !("task" in message)) return JSON.stringify(message);
  const { task, ...rest } = message as { task: Task };
  return JSON.stringify({ ...rest, [app.task_field]: task });
}

// ── Output frames ────────────────────────────────────────────────────────────

// A binary frame is one byte giving the id's length, the id, then the output bytes.
export function encode_chunk(id: string, data: Uint8Array): Buffer<ArrayBuffer> {
  const id_bytes = Buffer.from(id, "utf8");
  if (id_bytes.length > 255) throw new Error("A stream id is at most 255 bytes.");
  return Buffer.concat([Buffer.from([id_bytes.length]), id_bytes, data]);
}

export function decode_chunk(frame: Uint8Array): { id: string; data: Buffer } | null {
  const bytes = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  if (bytes.length < 1 || bytes.length < 1 + bytes[0]) return null;
  return { id: bytes.subarray(1, 1 + bytes[0]).toString("utf8"), data: bytes.subarray(1 + bytes[0]) };
}

// ── Key login ────────────────────────────────────────────────────────────────

// The upgrade header an agent logging in with its key names its host in, such as "x-nix-agent-host".
export function key_host_header(app_name: string): string {
  return `${app_name}-agent-host`;
}

// ── Long run ids ─────────────────────────────────────────────────────────────

// A long run's id names its folder on the agent, so it is kept to safe characters.
export function is_run_id(value: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(value);
}
