// Calls a server's JSON API: a body goes as JSON, a 401 throws LoginNeeded so the page can ask for a login, a 204 is no
// answer, and a refusal throws ApiError with the server's own words from { error } or { message }, or its plain text,
// or plain words for a proxy's HTML error page.

// ── Imports ──────────────────────────────────────────────────────────────────

import { LoginNeeded } from "./states.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  // The HTTP status, or null when the request never got an answer.
  status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Api = <Answer>(path: string, method?: ApiMethod, body?: unknown) => Promise<Answer>;

export interface ApiOptions {
  // Paths whose 401 is their answer rather than a lapsed session, such as the login itself.
  open_paths?: Iterable<string>;
  // Headers every request carries, read afresh each time, such as the client id of a change feed.
  headers?: () => Record<string, string>;
  // What a lapsed session says; "Sign in first." unless set.
  login_needed_text?: string;
  fetch?: typeof fetch;
}

// ── Requests ─────────────────────────────────────────────────────────────────

// What a proxy's own error page means, since its HTML is no message for a person.
const proxy_messages: Record<number, string> = {
  502: "The server could not be reached through its proxy (HTTP 502); it may be restarting, so try again in a moment.",
  503: "The server is not available just now (HTTP 503); try again in a moment.",
  504: "The server took too long to answer, so its proxy stopped waiting (HTTP 504). It may still be finishing what was asked; check before trying again.",
};

function is_html(text: string, response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html") || /^\s*</.test(text);
}

// The message a refused request's body gives: its { error } or { message }, the text itself, or for an HTML page, such
// as a proxy's, what its status means.
function refusal_message(text: string, response: Response): string {
  if (is_html(text, response)) return proxy_messages[response.status] ?? `The server refused the request (HTTP ${response.status}).`;
  try {
    const answer: unknown = JSON.parse(text);
    if (typeof answer === "object" && answer !== null) {
      const { error, message } = answer as { error?: unknown; message?: unknown };
      if (typeof error === "string" && error) return error;
      if (typeof message === "string" && message) return message;
    }
  } catch {
    // Not JSON, so the text is the message.
  }
  return text.trim() || `${response.status} ${response.statusText}`.trim();
}

export function create_api(options: ApiOptions = {}): Api {
  const open_paths = new Set(options.open_paths ?? []);
  const login_needed_text = options.login_needed_text ?? "Sign in first.";

  return async <Answer>(path: string, method: ApiMethod = "GET", body: unknown = undefined): Promise<Answer> => {
    const headers: Record<string, string> = { accept: "application/json", ...options.headers?.() };
    if (body !== undefined) headers["content-type"] = "application/json";
    const request: RequestInit = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(path, request);
    } catch (error) {
      throw new ApiError(`The server did not answer: ${(error as Error).message}`, null);
    }
    if (response.status === 401 && !open_paths.has(path.split("?")[0])) throw new LoginNeeded(login_needed_text);
    if (response.status === 204) return undefined as Answer;
    const text = await response.text();
    if (!response.ok) throw new ApiError(refusal_message(text, response), response.status);
    return (text === "" ? undefined : JSON.parse(text)) as Answer;
  };
}
