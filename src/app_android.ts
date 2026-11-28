#!/usr/bin/env node
// The `x-app-android [app folder]` command: an app's Android project, made and kept up to date from X-App, so no app
// keeps Capacitor's generated project by hand. It adds the project from Capacitor's template when the app has none,
// applies X-App's release settings (the version CI gives each build, and signing when the release key is present),
// draws the launcher icons from `resources/icon.svg`, and syncs the built page and plugins into it. Run it after the
// Android page is built, since Capacitor copies that page in.

// ── Imports ──────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { write_app_icons } from "./app_icons.ts";

// ── Release settings ─────────────────────────────────────────────────────────

// The line that applies X-App's release settings, from the app's own node_modules so it follows X-App's version.
export const release_line = `apply from: "../../node_modules/@x-tech-laboratories/x-app/config/android/release.gradle"`;

// Adds the release line to the app module's build file once, and says whether it had to.
export function apply_release_settings(app_folder: string): boolean {
  const build_file = join(app_folder, "android", "app", "build.gradle");
  const build = readFileSync(build_file, "utf8");
  if (build.includes(release_line)) return false;
  writeFileSync(build_file, `${build.trimEnd()}\n\n// X-App's release settings: the build's version and, when the key is present, its signature.\n${release_line}\n`);
  return true;
}

// ── Command ──────────────────────────────────────────────────────────────────

// Runs one Capacitor command in the app's folder, failing loudly; tests swap it for a recorder.
export type RunCapacitor = (app_folder: string, args: string[]) => void;

const run_capacitor: RunCapacitor = (app_folder, args) => {
  const result = spawnSync("npx", ["cap", ...args], { cwd: app_folder, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`cap ${args.join(" ")} failed`);
};

// Brings the app's Android project up to date and returns what it did, one line each.
export function prepare_android(app_folder: string, run: RunCapacitor = run_capacitor): string[] {
  if (!existsSync(join(app_folder, "capacitor.config.json"))) throw new Error(`no Android app: ${join(app_folder, "capacitor.config.json")} is missing`);
  const done: string[] = [];
  if (!existsSync(join(app_folder, "android"))) {
    run(app_folder, ["add", "android"]);
    done.push("Added the Android project from Capacitor's template");
  }
  if (apply_release_settings(app_folder)) done.push("Applied X-App's release settings");
  done.push(`Drew ${write_app_icons(app_folder).length} icons`);
  run(app_folder, ["sync", "android"]);
  done.push("Synced the page and plugins into the Android project");
  return done;
}

if (import.meta.main) {
  try {
    for (const line of prepare_android(resolve(process.argv[2] ?? "."))) console.info(line);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
