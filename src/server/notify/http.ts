// One HTTP request that delivers a notification, failing when it cannot be sent or the server does not accept it.

// ── Shapes ───────────────────────────────────────────────────────────────────

export type Fetch = typeof fetch;

export interface DeliveryRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  // How long the request may take; 10 seconds unless set.
  timeout_in_milliseconds?: number;
  // The fetch used, such as a test's stand-in; the global one unless set.
  fetch?: Fetch;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const delivery_timeout_in_milliseconds = 10_000;

// ── Sending ──────────────────────────────────────────────────────────────────

// Sends the request, throwing "HTTP <status>: <start of the reply>" for any answer from 300 up.
export async function deliver(request: DeliveryRequest): Promise<void> {
  const send = request.fetch ?? fetch;
  const response = await send(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(request.timeout_in_milliseconds ?? delivery_timeout_in_milliseconds),
  });
  if (response.status >= 300) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

// A Basic authorization header for a name and password.
export function basic_authorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
