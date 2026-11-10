// Calls a server's JSON API: a body goes as JSON, a 401 throws LoginNeeded so the page can ask for a login, a 204 is no
// answer, and a refusal throws ApiError with the server's own words from { error } or { message }, or its plain text.

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

// The message a refused request's body gives: its { error } or { message }, or the text itself.
function refusal_message(text: string, response: Response): string {
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
