import { describe, expect, test, vi } from "vitest";

import { define_events, type IpcRendererEventsLike } from "../../src/electron/events.ts";

interface ScanEvents extends Record<string, unknown> {
  progress: { done: number };
  finished: { files: number };
}

const scan_events = define_events<ScanEvents>("x_scan_events");

// A stand-in for ipcRenderer that delivers what the fake windows send.
function fake_ipc() {
  const listeners = new Map<string, Set<(event: unknown, message: unknown) => void>>();
  const ipc_renderer: IpcRendererEventsLike = {
    on: (channel, listener) => listeners.set(channel, (listeners.get(channel) ?? new Set()).add(listener)),
    removeListener: (channel, listener) => listeners.get(channel)?.delete(listener),
  };
  const window = { webContents: { send: (channel: string, message: unknown) => { for (const listener of listeners.get(channel) ?? []) listener({}, message); } } };
  return { ipc_renderer, window, listeners };
}

describe("define_events", () => {
  test("exposes a client that hears only the events it subscribed to, until it stops", () => {
    const { ipc_renderer, window, listeners } = fake_ipc();
    let exposed: unknown;
    scan_events.expose({ exposeInMainWorld: (api_name, api) => { expect(api_name).toBe("x_scan_events"); exposed = api; } }, ipc_renderer);
    const client = exposed as ReturnType<typeof scan_events.ipc_client>;
    const heard = vi.fn();

    const stop = client.on("progress", heard);
    scan_events.emit([window], "progress", { done: 3 });
    scan_events.emit([window], "finished", { files: 9 });
    stop();
    scan_events.emit([window], "progress", { done: 4 });

    expect(heard.mock.calls).toEqual([[{ done: 3 }]]);
    expect(listeners.get(scan_events.channel)?.size).toBe(0);
  });

  test("sends on one channel named for the api, to every window", () => {
    const sent = vi.fn();
    scan_events.emit([{ webContents: { send: sent } }, { webContents: { send: sent } }], "finished", { files: 2 });

    expect(scan_events.channel).toBe("x_scan_events:event");
    expect(sent).toHaveBeenCalledTimes(2);
    expect(sent).toHaveBeenCalledWith("x_scan_events:event", { name: "finished", payload: { files: 2 } });
  });
});
