// Fetching from Electron's main process for a page whose own requests the browser's cross-origin rules would block.

// ── Messages ─────────────────────────────────────────────────────────────────

export type HeaderList = [string, string][];

// A request as it crosses the bridge, its body read into bytes.
export interface FetchRequest {
  url: string;
  method: string;
  headers: HeaderList;
  body?: Uint8Array<ArrayBuffer>;
}

// A response as it crosses the bridge, its body read in full.
export interface FetchAnswer {
  status: number;
  status_text: string;
  headers: HeaderList;
  body: Uint8Array<ArrayBuffer> | null;
}

// The bridge method that carries it, such as define_bridge<{ http_fetch: FetchMethod }>.
export type FetchMethod = (request: FetchRequest) => FetchAnswer;

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

// ── Main process ─────────────────────────────────────────────────────────────

export interface FetchPolicy {
  // Host names the page may reach, where "*.example.com" stands for every subdomain of example.com.
  hosts: readonly string[];
  // Lets plain http through as well as https, such as for a server on this machine.
  allow_http?: boolean;
}

export function is_allowed_url(url: string, policy: FetchPolicy): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && !(policy.allow_http && parsed.protocol === "http:")) return false;

  return policy.hosts.some((host) => host.startsWith("*.") ? parsed.hostname.endsWith(host.slice(1)) : parsed.host === host || parsed.hostname === host);
}

// The body arrives already unpacked, so the headers describing the packed body are dropped.
const DROPPED_ANSWER_HEADERS = new Set(["content-encoding", "content-length"]);

// The main process's half: sends the page's request with Node's fetch, refusing any URL outside the policy.
export function create_main_fetch(policy: FetchPolicy, send: typeof fetch = fetch): (request: FetchRequest) => Promise<FetchAnswer> {
  return async (request) => {
    if (!is_allowed_url(request.url, policy)) throw new Error(`fetching ${request.url} is not allowed`);

    const response = await send(request.url, { method: request.method, headers: request.headers, body: request.body });

    const headers: HeaderList = [];
    response.headers.forEach((value, name) => {
      if (!DROPPED_ANSWER_HEADERS.has(name)) headers.push([name, value]);
    });
    const has_body = !NULL_BODY_STATUSES.has(response.status) && request.method !== "HEAD";

    return {
      status: response.status,
      status_text: response.statusText,
      headers,
      body: has_body ? new Uint8Array(await response.arrayBuffer()) : null,
    };
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export interface PageFetchOptions {
  // Headers set on every request over whatever the caller gave, such as an Origin the server insists on.
  pinned_headers?: Record<string, string>;
}

function abort_error(): DOMException {
  return new DOMException("The request was aborted", "AbortError");
}

// Rejects once the signal aborts, though the main process still finishes the request.
function until_aborted<Value>(promise: Promise<Value>, signal: AbortSignal | null | undefined): Promise<Value> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abort_error());
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(abort_error()), { once: true });
    promise.then(resolve, reject);
  });
}

export function to_response(answer: FetchAnswer): Response {
  const body = NULL_BODY_STATUSES.has(answer.status) ? null : answer.body;
  return new Response(body, { status: answer.status, statusText: answer.status_text, headers: answer.headers });
}

// The page's half: a fetch that sends each request through the bridge method, for libraries that take a fetch.
export function create_page_fetch(
  send: (request: FetchRequest) => Promise<FetchAnswer>,
  options: PageFetchOptions = {},
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const request = new Request(input, init);

    // A plain Headers keeps names a Request would drop, such as Origin and Referer.
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(options.pinned_headers ?? {})) headers.set(name, value);

    const body = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
    const answer = await until_aborted(send({ url: request.url, method: request.method, headers: [...headers.entries()], body }), init?.signal ?? request.signal);

    return to_response(answer);
  };
}
