// The base app's preload: gives the desktop app's page its calls to the main process, under the names the page looks
// for. It runs in the window's sandbox, so it imports nothing that needs Node.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { App } from "./define.ts";

// ── Preload ──────────────────────────────────────────────────────────────────

export interface PreloadElectron {
  contextBridge: Parameters<App["bridges"]["calls"]["expose"]>[0];
  ipcRenderer: Parameters<App["bridges"]["calls"]["expose"]>[1] & Parameters<App["bridges"]["events"]["expose"]>[1];
}

// Gives the desktop app's page its calls to the main process, under the names the page looks for.
export function run_preload(app: App, { contextBridge, ipcRenderer }: PreloadElectron): void {
  const { bridges } = app;
  for (const bridge of [bridges.calls, bridges.device, bridges.backups, bridges.certificates, bridges.peer_listening, bridges.desktop, bridges.connections]) {
    bridge.expose(contextBridge, ipcRenderer, { envelopes: true });
  }
  bridges.events.expose(contextBridge, ipcRenderer);
}
