// Fetching from Electron's main process for a page whose own requests the browser's cross-origin rules would block, with the body whole or streamed in chunks.

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

// A request whose body comes back in chunks tagged with the id the page chose.
export interface StreamRequest extends FetchRequest {
  stream_id: string;
}

// The status and headers of a streamed response; its chunks follow as events.
export type StreamHead = Omit<FetchAnswer, "body">;

// One piece of a streamed body, its end, or why it broke off.
export type StreamChunk =
  | { stream_id: string; bytes: Uint8Array<ArrayBuffer> }
  | { stream_id: string; done: true }
  | { stream_id: string; error: string };

// The bridge methods that carry a stream, such as define_bridge<{ http_stream: StreamStartMethod; http_stream_cancel: StreamCancelMethod }>.
export type StreamStartMethod = (request: StreamRequest) => StreamHead;
export type StreamCancelMethod = (stream_id: string) => void;

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

export interface MainStreamFetch {
  start: (request: StreamRequest) => Promise<StreamHead>;
  cancel: (stream_id: string) => void;
}

// The main process's half of a streamed fetch: answers with the head and sends each chunk of the body through emit as it arrives.
export function create_main_stream_fetch(policy: FetchPolicy, emit: (chunk: StreamChunk) => void, send: typeof fetch = fetch): MainStreamFetch {
  const open = new Map<string, AbortController>();

  async function pump(stream_id: string, body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const reader = body.getReader();
    try {
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        emit({ stream_id, bytes: new Uint8Array(value) });
      }
      if (!controller.signal.aborted) emit({ stream_id, done: true });
    } catch (error) {
      if (!controller.signal.aborted) emit({ stream_id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      open.delete(stream_id);
    }
  }

  return {
    start: async (request) => {
      if (!is_allowed_url(request.url, policy)) throw new Error(`fetching ${request.url} is not allowed`);
      const controller = new AbortController();
      open.set(request.stream_id, controller);

      const response = await send(request.url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
      const headers: HeaderList = [];
      response.headers.forEach((value, name) => {
        if (!DROPPED_ANSWER_HEADERS.has(name)) headers.push([name, value]);
      });

      const has_body = response.body !== null && !NULL_BODY_STATUSES.has(response.status) && request.method !== "HEAD";
      if (has_body) void pump(request.stream_id, response.body!, controller);
      else {
        open.delete(request.stream_id);
        emit({ stream_id: request.stream_id, done: true });
      }
      return { status: response.status, status_text: response.statusText, headers };
    },
    cancel: (stream_id) => {
      open.get(stream_id)?.abort();
      open.delete(stream_id);
    },
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

// ── Streaming page ───────────────────────────────────────────────────────────

export interface PageStreamBridge {
  start: (request: StreamRequest) => Promise<StreamHead>;
  cancel?: (stream_id: string) => Promise<void> | void;
  // Hands every chunk event to the handler, giving back the function that stops listening.
  on_chunk: (handler: (chunk: StreamChunk) => void) => () => void;
}

let next_stream_number = 0;

const new_stream_id = (): string => `${Date.now().toString(36)}-${(next_stream_number++).toString(36)}`;

// The page's half of a streamed fetch: a fetch whose Response body is a ReadableStream fed by the chunks, so a player reads them as they land.
export function create_page_stream_fetch(bridge: PageStreamBridge, options: PageFetchOptions = {}): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const request = new Request(input, init);
    const signal = init?.signal ?? request.signal;
    const stream_id = new_stream_id();

    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(options.pinned_headers ?? {})) headers.set(name, value);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());

    // Chunks may land before the head answers, so the listener is in place first and the stream holds them.
    let stop_listening = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const finish = () => { stop_listening(); signal?.removeEventListener("abort", on_abort); };
        const on_abort = () => {
          finish();
          void bridge.cancel?.(stream_id);
          try { controller.error(abort_error()); } catch { /* already closed */ }
        };
        stop_listening = bridge.on_chunk((chunk) => {
          if (chunk.stream_id !== stream_id) return;
          if ("bytes" in chunk) controller.enqueue(chunk.bytes);
          else {
            finish();
            if ("error" in chunk) controller.error(new TypeError(chunk.error));
            else controller.close();
          }
        });
        signal?.addEventListener("abort", on_abort, { once: true });
      },
      cancel() {
        stop_listening();
        void bridge.cancel?.(stream_id);
      },
    });

    try {
      const head = await until_aborted(bridge.start({ stream_id, url: request.url, method: request.method, headers: [...headers.entries()], body }), signal);
      const streams = !NULL_BODY_STATUSES.has(head.status) && request.method !== "HEAD";
      if (!streams) void stream.cancel();
      return new Response(streams ? stream : null, { status: head.status, statusText: head.status_text, headers: head.headers });
    } catch (error) {
      stop_listening();
      throw error;
    }
  };
}
