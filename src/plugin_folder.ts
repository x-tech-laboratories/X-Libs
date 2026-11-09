// Plugins kept in a folder on disk: each in a subfolder whose package.json names, under "x-plugin", its built entry for each side of the app, such as { "server": "dist/server.js", "web": "dist/web.js" }.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin, PluginApi } from "./plugins.ts";

export interface PluginEntry {
  // The subfolder's name, which is also its path under the server's plugins prefix.
  name: string;
  // The entry's path inside the subfolder, with forward slashes.
  path: string;
  file: string;
}

export interface PluginProblem {
  name: string;
  problem: string;
}

// The entries for one side, such as "server", "agent", "main" or "web"; a subfolder without one is skipped, a broken one is a problem.
export function plugin_entries(folder: string, side: string): { entries: PluginEntry[]; problems: PluginProblem[] } {
  const entries: PluginEntry[] = [];
  const problems: PluginProblem[] = [];
  if (!existsSync(folder)) return { entries, problems };
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith(".")) continue;
    const root = join(folder, item.name);
    try {
      const entry = entry_in(root, side);
      if (entry) entries.push({ name: item.name, ...entry });
    } catch (error) {
      problems.push({ name: item.name, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  return { entries, problems };
}

function entry_in(root: string, side: string): { path: string; file: string } | undefined {
  const manifest_file = join(root, "package.json");
  if (!existsSync(manifest_file)) throw new Error("It has no package.json.");
  const manifest: unknown = JSON.parse(readFileSync(manifest_file, "utf8"));
  const sides = manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>)["x-plugin"] : undefined;
  if (!sides || typeof sides !== "object") throw new Error('Its package.json has no "x-plugin" entries.');
  const path = (sides as Record<string, unknown>)[side];
  if (path === undefined) return undefined;
  if (typeof path !== "string") throw new Error(`Its ${side} entry is not a path.`);
  const file = inside(root, path);
  if (!file) throw new Error(`Its ${side} entry ${path} is outside its folder.`);
  if (!existsSync(file)) throw new Error(`Its ${side} entry ${path} is missing; is it built?`);
  return { path: relative(realpathSync(root), file).split(sep).join("/"), file };
}

// The file at path under root, or nothing when it, or a link it goes through, leads outside root.
export function inside(root: string, path: string): string | undefined {
  if (!existsSync(root)) return undefined;
  const real_root = realpathSync(root);
  const file = resolve(real_root, path);
  const real_file = existsSync(file) ? realpathSync(file) : file;
  return real_file.startsWith(real_root + sep) ? real_file : undefined;
}

// Imports each entry for the side; its default export, or an export named plugin, is the plugin.
export async function load_plugin_folder<Api extends PluginApi = PluginApi>(folder: string, side: string): Promise<{ plugins: Plugin<Api>[]; problems: PluginProblem[] }> {
  const { entries, problems } = plugin_entries(folder, side);
  const plugins: Plugin<Api>[] = [];
  for (const entry of entries) {
    try {
      const module = (await import(pathToFileURL(entry.file).href)) as { default?: Plugin<Api>; plugin?: Plugin<Api> };
      const plugin = module.default ?? module.plugin;
      if (!plugin || typeof plugin.start !== "function") throw new Error(`Its ${side} entry exports no plugin.`);
      plugins.push(plugin);
    } catch (error) {
      problems.push({ name: entry.name, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  return { plugins, problems };
}
