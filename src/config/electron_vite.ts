// The base app's electron-vite config: the desktop app's main process and daemon, its preload, and the page.

// ── Imports ──────────────────────────────────────────────────────────────────

import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { externalizeDepsPlugin, type UserConfig } from "electron-vite";

// ── Desktop ──────────────────────────────────────────────────────────────────

export interface DesktopViteOptions {
  // The daemon's entry, out/main/daemon.js beside the main process; src/daemon/main.ts unless set, null for none.
  daemon?: string | null;
}

export function desktop_vite_config(options: DesktopViteOptions = {}): UserConfig {
  const daemon = options.daemon === undefined ? "src/daemon/main.ts" : options.daemon;
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: { rollupOptions: { input: { index: resolve("src/main/index.ts"), ...(daemon ? { daemon: resolve(daemon) } : {}) } } },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: { rollupOptions: { input: { index: resolve("src/preload/index.ts") } } },
    },
    renderer: {
      root: resolve("src/web"),
      plugins: [react()],
      build: { rollupOptions: { input: { index: resolve("src/web/index.html") } } },
    },
  };
}
