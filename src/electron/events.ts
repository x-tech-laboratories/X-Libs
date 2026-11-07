// Messages the main process pushes to its pages, such as progress, on one channel and subscribed to by name.

import type { ContextBridgeLike } from "./bridge.ts";

// ── Electron's shapes ────────────────────────────────────────────────────────

export interface IpcRendererEventsLike {
  on(channel: string, listener: (event: unknown, message: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, message: unknown) => void): unknown;
}

export interface WindowLike {
  webContents: { send(channel: string, message: unknown): void };
}

// ── Events ───────────────────────────────────────────────────────────────────

// What the page holds: on returns the function that stops listening.
export interface EventsClient<Events extends Record<string, unknown>> {
  on<Name extends keyof Events & string>(name: Name, handler: (payload: Events[Name]) => void): () => void;
}

export interface EventsBridge<Events extends Record<string, unknown>> {
  api_name: string;
  channel: string;
  // The client the preload would expose, for a preload that adds its own extras.
  ipc_client: (ipc_renderer: IpcRendererEventsLike) => EventsClient<Events>;
  // In the preload: puts the client on the page's window under api_name.
  expose: (context_bridge: ContextBridgeLike, ipc_renderer: IpcRendererEventsLike) => void;
  // In the main process: sends one event to every window given.
  emit: <Name extends keyof Events & string>(windows: Iterable<WindowLike>, name: Name, payload: Events[Name]) => void;
}

export function define_events<Events extends Record<string, unknown>>(api_name: string): EventsBridge<Events> {
  const channel = `${api_name}:event`;

  const ipc_client = (ipc_renderer: IpcRendererEventsLike): EventsClient<Events> => ({
    on: (name, handler) => {
      const listener = (_event: unknown, message: unknown) => {
        const { name: sent_name, payload } = message as { name: string; payload: unknown };
        if (sent_name === name) handler(payload as Events[typeof name]);
      };
      ipc_renderer.on(channel, listener);
      return () => void ipc_renderer.removeListener(channel, listener);
    },
  });

  return {
    api_name,
    channel,
    ipc_client,
    expose: (context_bridge, ipc_renderer) => context_bridge.exposeInMainWorld(api_name, ipc_client(ipc_renderer)),
    emit: (windows, name, payload) => {
      for (const window of windows) window.webContents.send(channel, { name, payload });
    },
  };
}
