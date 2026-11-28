import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { prepare_android, release_line } from "../src/app_android.ts";

const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M63 32 47.5 58.847 16.5 58.847 1 32 16.5 5.153 47.5 5.153Z"/></svg>';
const stock_build = "apply plugin: 'com.android.application'\n\nandroid {\n}\n";

function android_app(): string {
  const app = mkdtempSync(join(tmpdir(), "android-"));
  mkdirSync(join(app, "resources"));
  writeFileSync(join(app, "resources", "icon.svg"), icon);
  writeFileSync(join(app, "capacitor.config.json"), JSON.stringify({ appId: "com.xtechlaboratories.xnotes", appName: "X-Notes", webDir: "out/android" }));
  return app;
}

// Stands in for Capacitor: `add` lays down the template's module build file and resources, as `cap add android` does.
function fake_capacitor(calls: string[][]) {
  return (app_folder: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "add") {
      mkdirSync(join(app_folder, "android", "app", "src", "main", "res"), { recursive: true });
      writeFileSync(join(app_folder, "android", "app", "build.gradle"), stock_build);
    }
  };
}

test("an app without an Android project gets one from Capacitor, with X-App's release settings and icons, then a sync", () => {
  const app = android_app();
  const calls: string[][] = [];

  const done = prepare_android(app, fake_capacitor(calls));

  expect(calls).toEqual([["add", "android"], ["sync", "android"]]);
  expect(done[0]).toBe("Added the Android project from Capacitor's template");
  expect(readFileSync(join(app, "android", "app", "build.gradle"), "utf8")).toContain(release_line);
  expect(existsSync(join(app, "android", "app", "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher.png"))).toBe(true);
});

test("a second run keeps the project, applies the release settings only once and syncs again", () => {
  const app = android_app();
  const calls: string[][] = [];
  prepare_android(app, fake_capacitor(calls));

  const done = prepare_android(app, fake_capacitor(calls));

  expect(calls).toEqual([["add", "android"], ["sync", "android"], ["sync", "android"]]);
  expect(done).not.toContain("Applied X-App's release settings");
  expect(readFileSync(join(app, "android", "app", "build.gradle"), "utf8").split(release_line)).toHaveLength(2);
});

test("an app's own committed project is kept and given the release settings", () => {
  const app = android_app();
  mkdirSync(join(app, "android", "app", "src", "main", "res"), { recursive: true });
  writeFileSync(join(app, "android", "app", "build.gradle"), stock_build);
  const calls: string[][] = [];

  expect(prepare_android(app, fake_capacitor(calls))).toContain("Applied X-App's release settings");
  expect(calls).toEqual([["sync", "android"]]);
});

test("a folder without a Capacitor config is not an Android app", () => {
  const app = mkdtempSync(join(tmpdir(), "android-"));

  expect(() => prepare_android(app, fake_capacitor([]))).toThrow("no Android app");
});

test("the release settings X-App ships take the version and the key from the environment", () => {
  const gradle = readFileSync(new URL("../config/android/release.gradle", import.meta.url), "utf8");

  for (const name of ["ANDROID_VERSION_CODE", "ANDROID_VERSION_NAME", "ANDROID_KEYSTORE_FILE", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS"]) expect(gradle).toContain(name);
});
