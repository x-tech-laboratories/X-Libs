// The built web page served from a folder, tuned for files from the Nix store: those are all dated 1970 and a rebuilt
// page keeps its size, so the size-and-date ETag is off and the page is fetched whole each time, while the bundles
// carry a content hash in their name and are kept for a year.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import fastify_static from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface WebFolderOptions {
  // The folder holding the built page.
  folder: string;
  // Files whose path holds this are kept for a year; "/assets/" unless set.
  immutable_path?: string;
  // The cache header on the page and every other file; "no-cache" unless set.
  page_cache_control?: string;
  // What happens when the folder is missing: a warning and only the API is served, an error, or nothing.
  when_missing?: "warn" | "throw" | "skip";
  // Serves the page for paths the server does not know, for a page that routes itself, except under the API prefix.
  page_fallback?: boolean;
  // Paths under this prefix are never the page; "/api/" unless set.
  api_prefix?: string;
  // Answers an unknown API path when page_fallback is on; plain text "not found" unless set.
  api_not_found?: (request: FastifyRequest, reply: FastifyReply) => unknown;
}

// ── Registration ─────────────────────────────────────────────────────────────

// Whether the folder was found and is being served.
export async function register_web_folder(app: FastifyInstance, options: WebFolderOptions): Promise<boolean> {
  const { immutable_path = "/assets/", page_cache_control = "no-cache", when_missing = "warn", api_prefix = "/api/" } = options;
  const folder = resolve(options.folder);

  if (!existsSync(folder)) {
    if (when_missing === "throw") throw new Error(`The web page is not built; nothing is at ${folder}`);
    if (when_missing === "warn") console.warn(`no web page found at ${folder}; only the API is served`);
    return false;
  }

  await app.register(fastify_static, {
    root: folder,
    etag: false,
    lastModified: false,
    cacheControl: false,
    setHeaders: (reply, path) => {
      const immutable = path.includes(immutable_path);
      void reply.header("cache-control", immutable ? "public, max-age=31536000, immutable" : page_cache_control);
    },
  });

  if (options.page_fallback) {
    const api_not_found = options.api_not_found ?? ((_request, reply) => reply.code(404).type("text/plain; charset=utf-8").send("not found"));
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      if (path.startsWith(api_prefix) || (request.method !== "GET" && request.method !== "HEAD")) return api_not_found(request, reply);
      return reply.header("cache-control", page_cache_control).sendFile("index.html");
    });
  }
  return true;
}
