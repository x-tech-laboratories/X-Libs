// Server-sent events: each open page keeps one stream and is told through it when the data changed, so it fetches at
// once instead of polling. Every stream gets a client id, so the page that made a change is not told about its own.

// ── Imports ──────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import type { FastifyInstance, FastifyRequest } from "fastify";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface EventStreamOptions {
  // How often a comment keeps a quiet stream open through proxies; 25 seconds unless set.
  heartbeat_ms?: number;
  // How long a browser waits before reconnecting a dropped stream; 3 seconds unless set.
  retry_ms?: number;
  // The first event, naming the stream's client id; null sends none.
  hello_event?: string | null;
  // The event announce_change sends.
  changed_event?: string;
  // The header a page sends its client id back in, so its own changes are not announced to it.
  client_id_header?: string;
}

export interface StreamClient {
  id: string;
  request: FastifyRequest;
}

export interface SendOptions {
  // The event's name; a nameless event reaches the browser's onmessage.
  event?: string;
  // The client left out, usually the one that made the change.
  except_client_id?: string;
  // Which clients get it; every client unless set.
  to?: (client: StreamClient) => boolean;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const default_client_id_header = "x-client-id";

// ── Stream ───────────────────────────────────────────────────────────────────

export class EventStream {
  readonly heartbeat_ms: number;
  readonly retry_ms: number;
  readonly hello_event: string | null;
  readonly changed_event: string;
  readonly client_id_header: string;
  private readonly streams = new Map<string, { client: StreamClient; response: ServerResponse }>();

  constructor(options: EventStreamOptions = {}) {
    this.heartbeat_ms = options.heartbeat_ms ?? 25_000;
    this.retry_ms = options.retry_ms ?? 3000;
    this.hello_event = options.hello_event === undefined ? "hello" : options.hello_event;
    this.changed_event = options.changed_event ?? "changed";
    this.client_id_header = options.client_id_header ?? default_client_id_header;
  }

  get client_count(): number {
    return this.streams.size;
  }

  // The client id a request carries, or "" for one that sent none.
  client_id_of(request: FastifyRequest): string {
    return String(request.headers[this.client_id_header] ?? "");
  }

  send(data: string, options: SendOptions = {}): void {
    const lines = data.split("\n").map((line) => `data: ${line}`).join("\n");
    const text = `${options.event === undefined ? "" : `event: ${options.event}\n`}${lines}\n\n`;
    for (const { client, response } of this.streams.values()) {
      if (client.id === options.except_client_id) continue;
      if (options.to !== undefined && !options.to(client)) continue;
      response.write(text);
    }
  }

  // The page that made a change already shows it, so only the others are told.
  announce_change(except_client_id = ""): void {
    this.send("", { event: this.changed_event, except_client_id });
  }

  // Serves the stream on the path, and ends every stream when the app closes, since one never ends by itself.
  register(app: FastifyInstance, path = "/events"): void {
    app.get(path, (request, reply) => {
      reply.hijack();
      const response = reply.raw;
      const id = randomUUID();
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      response.write(`retry: ${this.retry_ms}\n\n`);
      if (this.hello_event !== null) response.write(`event: ${this.hello_event}\ndata: ${id}\n\n`);
      this.streams.set(id, { client: { id, request }, response });

      const heartbeat = setInterval(() => response.write(": still here\n\n"), this.heartbeat_ms);
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        this.streams.delete(id);
      });
    });

    app.addHook("onClose", async () => this.close());
  }

  close(): void {
    for (const { response } of this.streams.values()) response.end();
    this.streams.clear();
  }
}
