import { describe, expect, test, vi } from "vitest";

import { to_base64 } from "../src/phone_backups.ts";
import { on_native_event } from "../src/phone_service.ts";
import { phone_sockets, type SocketsWindow } from "../src/phone_sockets.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

// The Android side as a script: each request is recorded and answered by `answer`, and `emit` sends events.
function fake_native(answer: (request: Record<string, unknown>) => Record<string, unknown> | Error) {
  const requests: Record<string, unknown>[] = [];
  const target: SocketsWindow = {};
  const emit = (message: Record<string, unknown>) => target.x_libs_native_event?.("sockets", JSON.stringify(message));
  target.XLibsSockets = {
    call(json) {
      const request = JSON.parse(json) as Record<string, unknown>;
      requests.push(request);
      const value = answer(request);
      queueMicrotask(() => emit(value instanceof Error ? { kind: "reply", id: request.id, ok: false, error: value.message } : { kind: "reply", id: request.id, ok: true, value }));
    },
  };
  return { target, requests, event: (socket: number, type: string, fields: Record<string, unknown> = {}) => emit({ kind: "event", socket, type, ...fields }) };
}

describe("phone sockets", () => {
  test("hands a UDP packet that came before the listener, and sends as base64", async () => {
    const native = fake_native((request) => (request.op === "udp_open" ? { socket: 1, port: 1716 } : {}));
    // The packet's event comes before the open's reply.
    native.target.XLibsSockets!.call = ((call) => (json: string) => {
      call(json);
      if (JSON.parse(json).op === "udp_open") native.event(1, "message", { data: to_base64(bytes("hello")), address: "192.168.0.3", port: 1716 });
    })(native.target.XLibsSockets!.call);
    const sockets = phone_sockets(native.target);
    expect(sockets.present).toBe(true);
    const udp = await sockets.udp_open({ port: 1716, broadcast: true });
    expect(udp.port).toBe(1716);
    const listener = vi.fn();
    udp.on_message(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ data: bytes("hello"), address: "192.168.0.3", port: 1716 });
    await udp.send(bytes("hi"), "192.168.0.255", 1716);
    expect(native.requests.at(-1)).toMatchObject({ op: "udp_send", socket: 1, data: to_base64(bytes("hi")), address: "192.168.0.255", port: 1716 });
  });

  test("reads a line, starts TLS, then reads and writes the rest, and tells of the close", async () => {
    const native = fake_native((request) => {
      if (request.op === "tcp_connect") return { socket: 4, local_port: 50000, remote_address: "192.168.0.3", remote_port: 1716 };
      if (request.op === "read_line") return { line: '{"type":"kdeconnect.identity"}' };
      if (request.op === "tls_start") return { peer_certificate: "PEM", protocol: "TLSv1.3", cipher: "TLS_AES_128_GCM_SHA256" };
      return {};
    });
    const sockets = phone_sockets(native.target);
    const socket = await sockets.tcp_connect({ host: "192.168.0.3", port: 1716 });
    expect([socket.local_port, socket.remote_address, socket.remote_port]).toEqual([50000, "192.168.0.3", 1716]);
    expect(await socket.read_line()).toBe('{"type":"kdeconnect.identity"}');
    expect(await socket.start_tls({ role: "client", certificate: "C", key: "K" })).toEqual({ peer_certificate: "PEM", protocol: "TLSv1.3", cipher: "TLS_AES_128_GCM_SHA256" });
    expect(native.requests.at(-1)).toMatchObject({ op: "tls_start", socket: 4, role: "client", certificate: "C", key: "K" });
    const data = vi.fn();
    socket.on_data((chunk) => data(text(chunk)));
    await socket.start_reading();
    native.event(4, "data", { data: to_base64(bytes("packet\n")) });
    expect(data).toHaveBeenCalledWith("packet\n");
    await socket.write(bytes("reply\n"));
    expect(native.requests.at(-1)).toMatchObject({ op: "write", socket: 4, data: to_base64(bytes("reply\n")) });
    await socket.pause();
    await socket.resume();
    expect(native.requests.slice(-2).map((request) => request.op)).toEqual(["pause", "resume"]);
    const closed = vi.fn();
    socket.on_close(closed);
    native.event(4, "close", { error: "reset" });
    expect(closed).toHaveBeenCalledWith("reset");
    await socket.close();
    expect(native.requests.at(-1)).toMatchObject({ op: "close", socket: 4 });
  });

  test("hands a listening server's connections on as sockets", async () => {
    const native = fake_native((request) => (request.op === "tcp_listen" ? { socket: 2, port: 1716 } : {}));
    const sockets = phone_sockets(native.target);
    const server = await sockets.tcp_listen({ port: 1716 });
    const accepted = vi.fn();
    server.on_connection(accepted);
    native.event(2, "connection", { connection: 3, local_port: 1716, remote_address: "192.168.0.4", remote_port: 40000 });
    expect(accepted.mock.calls[0]![0]).toMatchObject({ local_port: 1716, remote_address: "192.168.0.4", remote_port: 40000 });
    const closed = vi.fn();
    server.on_close(closed);
    native.event(2, "close", { error: null });
    expect(closed).toHaveBeenCalledWith(null);
  });

  test("lists the interfaces and rejects with the native side's error", async () => {
    const native = fake_native((request) => (request.op === "list_interfaces" ? { interfaces: [{ name: "wlan0", address: "192.168.0.5", broadcast: "192.168.0.255" }] } : new Error("address in use")));
    const sockets = phone_sockets(native.target);
    expect(await sockets.list_interfaces()).toEqual([{ name: "wlan0", address: "192.168.0.5", broadcast: "192.168.0.255" }]);
    await expect(sockets.tcp_listen({ port: 1716 })).rejects.toThrow("address in use");
  });

  test("is absent outside a worker, where every call fails", async () => {
    const sockets = phone_sockets({});
    expect(sockets.present).toBe(false);
    await expect(sockets.udp_open()).rejects.toThrow("phone service's worker");
  });
});

describe("native events", () => {
  test("go to the module's handler, the latest one", () => {
    const target: SocketsWindow = {};
    const first = vi.fn();
    const second = vi.fn();
    on_native_event("sockets", first, target);
    on_native_event("sockets", second, target);
    target.x_libs_native_event?.("sockets", "{}");
    target.x_libs_native_event?.("other", "{}");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith("{}");
  });
});
