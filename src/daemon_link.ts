// A desktop app's main process talking to whichever daemon `connections` has chosen: the local one over its Unix
// socket, or one on another host over http(s) with this device's token. Calls and change events look the same either
// way, so the page never knows where its daemon runs, and following the events moves to the new daemon by itself when
// the user picks another.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { Connections } from "./connections.ts";
import { call_daemon, daemon_answer, follow_daemon_events, parse_event, type FollowOptions } from "./local_daemon.ts";

// ── Link ─────────────────────────────────────────────────────────────────────

export interface DaemonLinkOptions {
  connections: Pick<Connections, "current" | "subscribe">;
  // The local daemon's socket, from `daemon_socket_path`.
  socket_path: string;
  // Sends the calls to a remote daemon, such as through a fetch that trusts certificates the user accepted.
  fetch?: typeof fetch;
}

export type DaemonLink = ReturnType<typeof create_daemon_link>;

const no_daemon_text = "No daemon is chosen yet. Choose one under Settings → Connections.";

export function create_daemon_link({ connections, socket_path, fetch: given_fetch }: DaemonLinkOptions) {
  const do_fetch = given_fetch ?? fetch;

  // Posts one call with its arguments as a JSON array and answers with what it returned; a refusal throws the daemon's words.
  async function call(path: string, args: unknown[] = [], headers: Record<string, string> = {}): Promise<unknown> {
    const daemon = connections.current();
    if (daemon === null) throw new Error(no_daemon_text);
    if (daemon.kind === "local") return call_daemon(socket_path, path, args, headers);
    let response: Response;
    try {
      response = await do_fetch(`${daemon.address}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${daemon.token}`, ...headers },
        body: JSON.stringify(args),
      });
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
      throw new Error(`The daemon at ${daemon.address} did not answer${cause}.`);
    }
    return daemon_answer({ status: response.status, text: await response.text() });
  }

  // Follows the chosen daemon's events, moving to another daemon when the user picks one; returns how to stop.
  function follow_events(path: string, on_event: (event: string, data: string) => void, options: FollowOptions = {}): () => void {
    function open(): () => void {
      const daemon = connections.current();
      if (daemon === null) return () => {};
      if (daemon.kind === "local") return follow_daemon_events(socket_path, path, on_event, options);
      return follow_remote_events(`${daemon.address}${path}`, { authorization: `Bearer ${daemon.token}` }, on_event, options, do_fetch);
    }

    let stop_current = open();
    const unsubscribe = connections.subscribe(() => {
      stop_current();
      stop_current = open();
    });
    return () => {
      unsubscribe();
      stop_current();
    };
  }

  return { call, follow_events };
}

// ── Remote events ────────────────────────────────────────────────────────────

// Follows a daemon's server-sent events over http(s), as `follow_daemon_events` does over the socket: each event's name
// and data, reconnecting whenever the stream ends or the daemon is out of reach. Returns how to stop.
export function follow_remote_events(
  url: string,
  headers: Record<string, string>,
  on_event: (event: string, data: string) => void,
  options: FollowOptions = {},
  do_fetch: typeof fetch = fetch,
): () => void {
  const retry_ms = options.retry_ms ?? 1000;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stream: AbortController | null = null;

  async function read(connection: { connected: boolean }): Promise<void> {
    stream = new AbortController();
    const response = await do_fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: stream.signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return;
    }
    connection.connected = true;
    options.on_connect?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const parsed = parse_event(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (parsed) on_event(parsed.event, parsed.data);
      }
    }
  }

  function open(): void {
    const connection = { connected: false };
    void read(connection)
      .catch(() => undefined)
      .finally(() => {
        stream = null;
        if (connection.connected && !stopped) options.on_disconnect?.();
        if (!stopped) retry = setTimeout(open, retry_ms);
      });
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    stream?.abort();
  };
}
