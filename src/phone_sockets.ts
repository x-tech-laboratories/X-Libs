// UDP and TCP sockets for a phone service's worker (see phone_service), answered by X-App's Android side: TLS can be
// started on a connected socket in either role after plain text, as KDE Connect does after its identity line, with
// the app's own certificate and key, and any peer is let through for the worker to check its certificate itself.
// A TCP socket reads nothing until asked, by read_line for one line or start_reading for everything after it, so no
// byte meant for TLS is read as plain text. UDP sockets opened for broadcast hold Android's multicast lock, which
// needs CHANGE_WIFI_MULTICAST_STATE in the app's manifest; WAKE_LOCK there lets the worker answer while the phone sleeps.

// ── Imports ──────────────────────────────────────────────────────────────────

import { from_base64, to_base64 } from "./phone_backups.ts";
import { on_native_event, type NativeWindow } from "./phone_service.ts";

// ── Native side ──────────────────────────────────────────────────────────────

export interface SocketsWindow extends NativeWindow {
  XLibsSockets?: { call: (request: string) => void };
}

type Reply = { kind: "reply"; id: number; ok: true; value: Record<string, unknown> } | { kind: "reply"; id: number; ok: false; error: string };
type SocketEvent = { kind: "event"; socket: number; type: string } & Record<string, unknown>;

// ── Listeners with a backlog ─────────────────────────────────────────────────

// Hands values to listeners, keeping those that come before the first listener.
function channel<Value>() {
  const listeners = new Set<(value: Value) => void>();
  let backlog: Value[] = [];
  return {
    push(value: Value) {
      if (listeners.size === 0) backlog.push(value);
      else for (const listener of listeners) listener(value);
    },
    listen(listener: (value: Value) => void): () => void {
      listeners.add(listener);
      const kept = backlog;
      backlog = [];
      for (const value of kept) listener(value);
      return () => void listeners.delete(listener);
    },
  };
}

// ── Sockets ──────────────────────────────────────────────────────────────────

export interface Closable {
  // Called once with the reason the socket closed, or null when it closed normally.
  on_close: (listener: (error: string | null) => void) => () => void;
  close: () => Promise<void>;
}

export interface UdpSocket extends Closable {
  port: number;
  send: (data: Uint8Array, address: string, port: number) => Promise<void>;
  on_message: (listener: (message: { data: Uint8Array; address: string; port: number }) => void) => () => void;
}

export interface TlsSession {
  // The peer's certificate as PEM, or null when it sent none.
  peer_certificate: string | null;
  protocol: string;
  cipher: string;
}

export interface TcpSocket extends Closable {
  local_port: number;
  remote_address: string;
  remote_port: number;
  read_line: () => Promise<string>;
  // `role` is the TLS role, which need not match who connected; as a server it asks the peer for its certificate.
  start_tls: (options: { role: "client" | "server"; certificate: string; key: string }) => Promise<TlsSession>;
  start_reading: () => Promise<void>;
  on_data: (listener: (data: Uint8Array) => void) => () => void;
  // Stops and restarts reading, for a slow consumer.
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  // Settles once the bytes are written.
  write: (data: Uint8Array) => Promise<void>;
}

export interface TcpServer extends Closable {
  port: number;
  on_connection: (listener: (socket: TcpSocket) => void) => () => void;
}

export interface NetworkInterfaceAddress {
  name: string;
  address: string;
  broadcast: string | null;
}

export interface PhoneSockets {
  // Whether this page runs as a phone service's worker, where the sockets are.
  readonly present: boolean;
  udp_open: (options?: { port?: number; broadcast?: boolean }) => Promise<UdpSocket>;
  tcp_listen: (options?: { port?: number; host?: string }) => Promise<TcpServer>;
  tcp_connect: (options: { host: string; port: number; timeout_ms?: number }) => Promise<TcpSocket>;
  list_interfaces: () => Promise<NetworkInterfaceAddress[]>;
}

export function phone_sockets(target: SocketsWindow = globalThis as SocketsWindow): PhoneSockets {
  let next_id = 1;
  const waiting = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  // Each socket's events, kept from before the socket's object exists.
  const events = new Map<number, ReturnType<typeof channel<SocketEvent>>>();
  const events_of = (socket: number) => {
    let found = events.get(socket);
    if (!found) events.set(socket, (found = channel<SocketEvent>()));
    return found;
  };

  on_native_event("sockets", (json) => {
    const message = JSON.parse(json) as Reply | SocketEvent;
    if (message.kind === "reply") {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.ok) entry?.resolve(message.value);
      else entry?.reject(new Error(message.error));
    } else {
      events_of(message.socket).push(message);
    }
  }, target);

  const call = (op: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const native = target.XLibsSockets;
    if (!native) return Promise.reject(new Error("sockets work only in a phone service's worker"));
    const id = next_id++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      native.call(JSON.stringify({ id, op, ...fields }));
    });
  };

  // What every socket has: its events split by type, and closing.
  function base(socket: number) {
    const closed = channel<string | null>();
    const by_type = new Map<string, ReturnType<typeof channel<SocketEvent>>>();
    const of_type = (type: string) => {
      let found = by_type.get(type);
      if (!found) by_type.set(type, (found = channel<SocketEvent>()));
      return found;
    };
    events_of(socket).listen((event) => {
      if (event.type === "close") {
        events.delete(socket);
        closed.push((event.error as string | null) ?? null);
      } else {
        of_type(event.type).push(event);
      }
    });
    return {
      of_type,
      closable: {
        on_close: (listener: (error: string | null) => void) => closed.listen(listener),
        close: async () => void (await call("close", { socket })),
      } satisfies Closable,
    };
  }

  function tcp_socket(socket: number, value: Record<string, unknown>): TcpSocket {
    const { of_type, closable } = base(socket);
    return {
      ...closable,
      local_port: value.local_port as number,
      remote_address: value.remote_address as string,
      remote_port: value.remote_port as number,
      read_line: async () => (await call("read_line", { socket })).line as string,
      start_tls: async (options) => (await call("tls_start", { socket, ...options })) as unknown as TlsSession,
      start_reading: async () => void (await call("start_reading", { socket })),
      on_data: (listener) => of_type("data").listen((event) => listener(from_base64(event.data as string))),
      pause: async () => void (await call("pause", { socket })),
      resume: async () => void (await call("resume", { socket })),
      write: async (data) => void (await call("write", { socket, data: to_base64(data) })),
    };
  }

  return {
    present: target.XLibsSockets !== undefined,
    async udp_open(options = {}) {
      const value = await call("udp_open", options);
      const socket = value.socket as number;
      const { of_type, closable } = base(socket);
      return {
        ...closable,
        port: value.port as number,
        send: async (data, address, port) => void (await call("udp_send", { socket, data: to_base64(data), address, port })),
        on_message: (listener) => of_type("message").listen((event) => listener({ data: from_base64(event.data as string), address: event.address as string, port: event.port as number })),
      };
    },
    async tcp_listen(options = {}) {
      const value = await call("tcp_listen", options);
      const socket = value.socket as number;
      const { of_type, closable } = base(socket);
      return {
        ...closable,
        port: value.port as number,
        on_connection: (listener) => of_type("connection").listen((event) => listener(tcp_socket(event.connection as number, event))),
      };
    },
    async tcp_connect(options) {
      const value = await call("tcp_connect", options);
      return tcp_socket(value.socket as number, value);
    },
    list_interfaces: async () => (await call("list_interfaces")).interfaces as NetworkInterfaceAddress[],
  };
}
