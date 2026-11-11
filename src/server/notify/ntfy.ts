// ntfy: a notification published to a topic on an ntfy server as JSON, with its priority, tags and a link that
// opens when it is tapped, signed in with an access token or a name and password when the server asks.

// ── Imports ──────────────────────────────────────────────────────────────────

import { basic_authorization, deliver, type Fetch } from "./http.ts";
import { setting_secret } from "./settings.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface NtfySettings {
  // The server, without a trailing slash.
  url: string;
  topic: string;
  headers: Record<string, string>;
}

export interface NtfyMessage {
  title: string;
  message: string;
  // 1 (min) to 5 (max); 3 unless set.
  priority?: number;
  tags?: string[];
  // Opened when the notification is tapped.
  click?: string | null;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const default_ntfy_url = "https://ntfy.sh";

export const ntfy_priorities: Record<string, number> = { min: 1, low: 2, default: 3, high: 4, max: 5, urgent: 5 };

// Reads `url`, `topic` or `topic_file`, `token` or `token_file`, and `username` with `password` or `password_file`.
export function ntfy_settings(config: Record<string, unknown>): NtfySettings {
  const url = String(config.url || default_ntfy_url).replace(/\/+$/, "");
  const topic = setting_secret(config, "topic");
  if (!topic) throw new Error("an ntfy channel needs `topic` or `topic_file`");
  const headers: Record<string, string> = {};
  const token = setting_secret(config, "token");
  const password = setting_secret(config, "password");
  if (token) headers.Authorization = `Bearer ${token}`;
  // A name and password take the place of a token, as a request sends only one authorization.
  if (config.username) headers.Authorization = basic_authorization(String(config.username), password ?? "");
  return { url, topic, headers };
}

// A priority given by name or as 1 to 5.
export function ntfy_priority(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) return value;
  const named = ntfy_priorities[String(value).toLowerCase()];
  if (named !== undefined) return named;
  throw new Error(`\`priority\` must be 1-5 or one of ${Object.keys(ntfy_priorities).join(", ")}, not ${JSON.stringify(value)}`);
}

// Tags given as a list or as one comma-separated string.
export function ntfy_tags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return String(value).split(",").map((tag) => tag.trim()).filter((tag) => tag !== "");
}

// ── Sending ──────────────────────────────────────────────────────────────────

export async function send_ntfy(settings: NtfySettings, message: NtfyMessage, options: { fetch?: Fetch; timeout_in_milliseconds?: number } = {}): Promise<void> {
  const publish: Record<string, unknown> = {
    topic: settings.topic,
    title: message.title,
    message: message.message || message.title,
    priority: message.priority ?? 3,
    tags: message.tags ?? [],
  };
  if (message.click) publish.click = message.click;
  await deliver({
    method: "POST", url: settings.url, body: JSON.stringify(publish),
    headers: { "Content-Type": "application/json", ...settings.headers }, ...options,
  });
}
