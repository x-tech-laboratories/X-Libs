// The page's side of server/events: one EventSource whose change events bump a watch, so every resource reading it
// loads again, and whose client id goes back with the page's own requests so it is not told of its own changes.

// ── Imports ──────────────────────────────────────────────────────────────────

import { create_watch, type Watch } from "./watch.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// The part of EventSource the feed uses, so tests can stand one in.
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
}

export interface ChangeFeedOptions {
  // The event server/events sends for a change, and the one naming the client id; "changed" and "hello" unless set.
  changed_event?: string;
  hello_event?: string;
  // A watch the page holds, so what reads it outlives one feed, such as across a new login; a new one unless set.
  watch?: Watch;
  create?: (path: string) => EventSourceLike;
}

export interface ChangeFeed {
  // Bumped on every change, and again once a dropped stream is back, as changes may have been missed meanwhile.
  watch: Watch;
  // The id to send in the client id header; "" until the stream says it.
  client_id(): string;
  close(): void;
}

// ── Feed ─────────────────────────────────────────────────────────────────────

export function follow_changes(path: string, options: ChangeFeedOptions = {}): ChangeFeed {
  const watch = options.watch ?? create_watch();
  const source = (options.create ?? ((url) => new EventSource(url)))(path);
  let client_id = "";
  let opened_before = false;

  source.addEventListener(options.hello_event ?? "hello", (event) => {
    client_id = event.data;
  });
  source.addEventListener(options.changed_event ?? "changed", () => watch.bump());
  source.onopen = () => {
    if (opened_before) watch.bump();
    opened_before = true;
  };

  return { watch, client_id: () => client_id, close: () => source.close() };
}
