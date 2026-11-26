import { describe, expect, test, vi } from "vitest";

import { phone_service, worker_host, type ForegroundServicePlugin, type WorkerWindow } from "../src/phone_service.ts";

// The Android plugin as a stub that records calls and can send worker messages.
function fake_plugin() {
  let listener: ((event: { message: string }) => void) | null = null;
  const remove = vi.fn(async () => void (listener = null));
  const plugin: ForegroundServicePlugin = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    get_state: async () => ({ running: true, start_at_boot: false }),
    post: vi.fn(async () => {}),
    addListener: vi.fn(async (_event, next) => ((listener = next), { remove })),
  };
  return { plugin, remove, send: (message: string) => listener?.({ message }) };
}

describe("phone service", () => {
  test("starts with its notification and worker, and posts JSON", async () => {
    const { plugin } = fake_plugin();
    const service = phone_service({ title: "X-Control", text: "Reachable", worker: "worker.html", plugin });
    await service.start();
    expect(plugin.start).toHaveBeenCalledWith({ title: "X-Control", text: "Reachable", worker: "worker.html", start_at_boot: false });
    await service.post({ type: "ping" });
    expect(plugin.post).toHaveBeenCalledWith({ message: '{"type":"ping"}' });
    expect(await service.is_running()).toBe(true);
    await service.stop();
    expect(plugin.stop).toHaveBeenCalled();
  });

  test("hands the worker's messages to every listener, skips text that is not JSON, and stops listening after the last leaves", async () => {
    const { plugin, remove, send } = fake_plugin();
    const service = phone_service<{ n: number }>({ title: "", text: "", worker: "w.html", plugin });
    const first = vi.fn();
    const second = vi.fn();
    const stop_first = service.on_message(first);
    const stop_second = service.on_message(second);
    await Promise.resolve();
    expect(plugin.addListener).toHaveBeenCalledTimes(1);
    send('{"n":1}');
    send("not json");
    expect(first).toHaveBeenCalledWith({ n: 1 });
    expect(second).toHaveBeenCalledTimes(1);
    stop_first();
    expect(remove).not.toHaveBeenCalled();
    stop_second();
    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
  });
});

describe("worker host", () => {
  test("posts JSON to the service and hands on what the service delivers", () => {
    const sent: string[] = [];
    const target: WorkerWindow = { XLibsWorkerHost: { post: (message) => void sent.push(message) } };
    const host = worker_host<{ type: string }>(target);
    expect(host.present).toBe(true);
    host.post({ type: "ready" });
    expect(sent).toEqual(['{"type":"ready"}']);
    const listener = vi.fn();
    const stop = host.on_message(listener);
    target.x_libs_worker_receive?.('{"type":"ping"}');
    target.x_libs_worker_receive?.("{");
    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: "ping" });
    stop();
    target.x_libs_worker_receive?.('{"type":"ping"}');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("is absent outside the service, and posting then does nothing", () => {
    const host = worker_host({});
    expect(host.present).toBe(false);
    expect(() => host.post({})).not.toThrow();
  });
});
