// A generic webhook: each notification sent to a URL as JSON, or as the payload template given with `{name}`
// placeholders filled from the notification's values; a template that is a string goes as plain text.

// ── Imports ──────────────────────────────────────────────────────────────────

import { deliver, type Fetch } from "./http.ts";
import { setting_secret } from "./settings.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface WebhookSettings {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers: Record<string, string>;
  // The template the body is filled from, or null to send the default body as JSON.
  payload: unknown;
}

export interface WebhookSend {
  // The values a template's placeholders take, by name.
  values: Record<string, string>;
  // What is sent as JSON when there is no template.
  default_body: unknown;
  fetch?: Fetch;
  timeout_in_milliseconds?: number;
}

const methods = ["POST", "PUT", "PATCH"] as const;

// ── Settings ─────────────────────────────────────────────────────────────────

// Reads `url` or `url_file`, `method`, `headers`, `bearer_token` or `bearer_token_file` and `payload`, throwing on a mistake.
export function webhook_settings(config: Record<string, unknown>): WebhookSettings {
  const url = setting_secret(config, "url");
  if (!url) throw new Error("a webhook channel needs `url` or `url_file`");
  const method = String(config.method ?? "POST").toUpperCase();
  if (!(methods as readonly string[]).includes(method)) throw new Error(`\`method\` must be POST, PUT or PATCH, not ${JSON.stringify(method)}`);
  const given = config.headers ?? {};
  if (typeof given !== "object" || given === null || Array.isArray(given)) throw new Error("`headers` must be a mapping of header names to values");
  const headers = Object.fromEntries(Object.entries(given).map(([name, value]) => [name, String(value)]));
  const token = setting_secret(config, "bearer_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url, method: method as WebhookSettings["method"], headers, payload: config.payload ?? null };
}

// ── Templates ────────────────────────────────────────────────────────────────

// Fills `{name}` in every string of a template, nested ones included; a name without a value is left as written.
export function fill_placeholders(template: unknown, values: Record<string, string>): unknown {
  if (typeof template === "string") return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? values[name]! : whole));
  if (Array.isArray(template)) return template.map((entry) => fill_placeholders(entry, values));
  if (typeof template === "object" && template !== null) {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, fill_placeholders(value, values)]));
  }
  return template;
}

// ── Sending ──────────────────────────────────────────────────────────────────

export async function send_webhook(settings: WebhookSettings, send: WebhookSend): Promise<void> {
  const common = { method: settings.method, url: settings.url, fetch: send.fetch, timeout_in_milliseconds: send.timeout_in_milliseconds };
  const body = settings.payload === null ? send.default_body : fill_placeholders(settings.payload, send.values);
  if (settings.payload !== null && typeof body === "string") {
    await deliver({ ...common, body, headers: { "Content-Type": "text/plain; charset=utf-8", ...settings.headers } });
    return;
  }
  await deliver({ ...common, body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...settings.headers } });
}
