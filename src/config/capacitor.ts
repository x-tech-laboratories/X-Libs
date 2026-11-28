// Stands in for Capacitor in an app that has no phone app: the base app's page loads its phone host only on a phone,
// but the bundler still follows that import, so without Capacitor installed the build would fail. An app that has
// Capacitor gets the real one.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import { join } from "node:path";

import type { Plugin } from "vite";

// ── Stand-ins ────────────────────────────────────────────────────────────────

// What the base app takes from each package, none of which a page off the phone ever calls.
const stand_ins: Record<string, string> = {
  "@capacitor/core": `export function registerPlugin() { throw new Error("Capacitor is not installed in this app."); }\nexport const Capacitor = { getPlatform: () => "web", isNativePlatform: () => false };\n`,
  "@capacitor/app": `export const App = { addListener: () => { throw new Error("Capacitor is not installed in this app."); } };\n`,
};

const prefix = "\0x-app-capacitor:";

// Whether the app at root has the package installed.
export function has_package(root: string, name: string): boolean {
  try {
    createRequire(join(root, "package.json")).resolve(name);
    return true;
  } catch {
    return false;
  }
}

// Points the Capacitor imports at stand-ins when the app at root, the working directory unless given, lacks them.
export function capacitor_stand_in(root: string = process.cwd()): Plugin {
  const missing = new Set(Object.keys(stand_ins).filter((name) => !has_package(root, name)));
  return {
    name: "x-app-capacitor-stand-in",
    enforce: "pre",
    resolveId: (source) => (missing.has(source) ? prefix + source : null),
    load: (id) => (id.startsWith(prefix) ? stand_ins[id.slice(prefix.length)] : null),
  };
}
