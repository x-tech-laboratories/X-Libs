// The base app's Vite configs: the page for a browser, and the page for the phone app, built from src/web.

// ── Imports ──────────────────────────────────────────────────────────────────

import react from "@vitejs/plugin-react";
import type { Plugin, UserConfig } from "vite";

// ── Web ──────────────────────────────────────────────────────────────────────

export interface WebViteOptions {
  // The server's port, which the dev page's API calls go to; PORT overrides it.
  port: number;
}

// The page for a browser, with relative paths so a proxy can serve it under a folder; the dev page reaches the API
// through the separately running server.
export function web_vite_config({ port }: WebViteOptions): UserConfig {
  const server = `http://127.0.0.1:${Number(process.env.PORT ?? port)}`;
  return {
    root: "src/web",
    base: "./",
    plugins: [react()],
    build: { outDir: "../../out/web", emptyOutDir: true },
    server: { proxy: { "/api": server, "/login": server } },
  };
}

// ── Android ──────────────────────────────────────────────────────────────────

// The phone runs SQLite as WebAssembly and syncs with a server elsewhere, which the browser page's policy forbids.
export const android_content_policy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: http:";

function set_content_policy(): Plugin {
  return {
    name: "x-app-android-content-policy",
    transformIndexHtml: (html) => html.replace(/(http-equiv="Content-Security-Policy" content=")[^"]*/, `$1${android_content_policy}`),
  };
}

// The page for the Capacitor app, built into out/android with its own content policy.
export function android_vite_config(): UserConfig {
  return {
    root: "src/web",
    base: "./",
    mode: "android",
    plugins: [react(), set_content_policy()],
    optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
    build: { outDir: "../../out/android", emptyOutDir: true },
  };
}
