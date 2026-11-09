// Plugins a page loads at run time from its server's plugins folder. Each web entry is one bundled ESM file, imported from
// a data URL; its imports of modules the page shares, such as "react", are pointed at the page's own copies, since a
// loaded file cannot resolve them. es-module-lexer finds the imports, chosen because it is what es-module-shims rewrites
// import maps with and parses a bundle in a millisecond; import maps cannot be added once a page has loaded a module.

import { init, parse } from "es-module-lexer";
import type { Plugin, PluginApi } from "../plugins.ts";

export interface LoadedPlugins<Api extends PluginApi> {
  plugins: Plugin<Api>[];
  // By entry URL or plugin subfolder name.
  problems: { name: string; problem: string }[];
}

const SHARED = Symbol.for("x-libs.plugin_modules");
const shims = new Map<string, string>();

function shared_modules(): Record<string, object> {
  const holder = globalThis as unknown as Record<symbol, Record<string, object> | undefined>;
  return (holder[SHARED] ??= {});
}

// Hands plugins the page's own modules by specifier, such as { react: React, "react/jsx-runtime": jsx_runtime }.
export function share_modules(modules: Record<string, object>): void {
  Object.assign(shared_modules(), modules);
  for (const specifier of Object.keys(modules)) shims.delete(specifier);
}

// A module that re-exports the shared one's names, so `import { useState } from "react"` reads the page's React.
function shim_url(specifier: string): string | undefined {
  const module = shared_modules()[specifier];
  if (!module) return undefined;
  const cached = shims.get(specifier);
  if (cached) return cached;
  const names = Object.keys(module).filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name));
  const source = [
    `const m = globalThis[Symbol.for("x-libs.plugin_modules")][${JSON.stringify(specifier)}];`,
    `export default ("default" in m ? m.default : m);`,
    names.length ? `export const { ${names.join(", ")} } = m;` : "",
  ].join("\n");
  const url = module_url(source);
  shims.set(specifier, url);
  return url;
}

// A data URL rather than a blob one, so nothing is left to revoke and Node can import it too.
function module_url(source: string): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

function is_bare(specifier: string): boolean {
  return !/^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(specifier);
}

// The entry's source with shared imports pointed at their shims and relative ones made absolute, or why it cannot load.
export async function rewrite_imports(source: string, entry_url: string): Promise<string> {
  await init;
  const [imports] = parse(source);
  let rewritten = "";
  let last = 0;
  for (const found of imports) {
    // import.meta and a dynamic import of an expression have no name to rewrite.
    if (typeof found.specifier !== "string" || ("glob" in found && found.glob)) continue;
    let target = found.specifier;
    if (is_bare(target)) {
      const url = shim_url(target);
      if (!url) throw new Error(`It imports ${target}, which the app does not share; bundle it into the plugin.`);
      target = url;
    } else {
      target = new URL(target, entry_url).href;
    }
    // A dynamic import's range holds the quotes, a static one's does not.
    rewritten += source.slice(last, found.start) + (found.type === "dynamic" ? JSON.stringify(target) : target);
    last = found.end;
  }
  return rewritten + source.slice(last);
}

// Reads the server's list, such as register_plugin_files' /plugins/index.json, and imports every entry on it.
export async function load_plugin_modules<Api extends PluginApi = PluginApi>(index_url = "plugins/index.json", fetch_text: (url: string) => Promise<string> = default_fetch_text): Promise<LoadedPlugins<Api>> {
  const index_href = new URL(index_url, typeof document === "undefined" ? undefined : document.baseURI).href;
  const list = JSON.parse(await fetch_text(index_href)) as { entries: string[]; problems?: { name: string; problem: string }[] };
  const result: LoadedPlugins<Api> = { plugins: [], problems: [...(list.problems ?? [])] };
  for (const entry of list.entries) {
    const entry_url = new URL(entry, index_href).href;
    try {
      const source = await rewrite_imports(await fetch_text(entry_url), entry_url);
      const module = (await import(/* @vite-ignore */ module_url(source))) as { default?: Plugin<Api>; plugin?: Plugin<Api> };
      const plugin = module.default ?? module.plugin;
      if (!plugin || typeof plugin.start !== "function") throw new Error("It exports no plugin.");
      result.plugins.push(plugin);
    } catch (error) {
      result.problems.push({ name: entry_url, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

async function default_fetch_text(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response.text();
}
