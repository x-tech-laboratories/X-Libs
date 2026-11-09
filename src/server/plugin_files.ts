// The page's side of a plugins folder: a list of the web entries and the files under each plugin's subfolder, read afresh so a plugin dropped in shows on the next load.

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { inside, plugin_entries } from "../plugin_folder.ts";

export interface PluginFilesOptions {
  folder: string;
  // The URL prefix; "/plugins" unless set, so the list is at /plugins/index.json.
  prefix?: string;
  // The side whose entries the page loads; "web" unless set.
  side?: string;
}

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

// Answers with { entries: [url], problems: [{ name, problem }] }, the URLs relative to the list itself.
export function register_plugin_files(app: FastifyInstance, options: PluginFilesOptions): void {
  const prefix = (options.prefix ?? "/plugins").replace(/\/$/, "");
  const folder = resolve(options.folder);
  const side = options.side ?? "web";

  app.get(`${prefix}/index.json`, async (_request, reply) => {
    const { entries, problems } = plugin_entries(folder, side);
    void reply.header("cache-control", "no-cache");
    return { entries: entries.map((entry) => `${encodeURIComponent(entry.name)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`), problems };
  });

  app.get<{ Params: { name: string; "*": string } }>(`${prefix}/:name/*`, async (request, reply) => {
    const { name, "*": path } = request.params;
    const root = name.startsWith(".") ? undefined : inside(folder, name);
    const file = root && inside(root, path);
    const contents = file ? await readFile(file).catch(() => undefined) : undefined;
    if (!file || !contents) return reply.code(404).type("text/plain; charset=utf-8").send("not found");
    return reply.header("cache-control", "no-cache").type(TYPES[extname(file).toLowerCase()] ?? "application/octet-stream").send(contents);
  });
}
