import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { render_png, write_app_icons } from "../src/app_icons.ts";

const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#0088ff" d="M63 32 47.5 58.847 16.5 58.847 1 32 16.5 5.153 47.5 5.153Z"/></svg>';

// A PNG's width and height sit in its header.
function png_size(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function app_with(...folders: string[]): string {
  const app = mkdtempSync(join(tmpdir(), "icons-"));
  mkdirSync(join(app, "resources"));
  writeFileSync(join(app, "resources", "icon.svg"), icon);
  for (const folder of folders) mkdirSync(join(app, folder), { recursive: true });
  return app;
}

test("an icon is drawn at the size asked for", () => {
  expect(png_size(render_png(icon, 192))).toEqual([192, 192]);
});

test("a desktop-only app gets only the desktop icon", () => {
  const app = app_with();

  expect(write_app_icons(app)).toEqual([join(app, "resources", "icon.png")]);
  expect(png_size(readFileSync(join(app, "resources", "icon.png")))).toEqual([512, 512]);
});

test("an Android app gets every launcher density and an adaptive icon, with Capacitor's own drawables gone", () => {
  const app = app_with("android/app/src/main/res/drawable-v24", "src/web/public");
  const res = join(app, "android/app/src/main/res");
  writeFileSync(join(res, "drawable-v24", "ic_launcher_foreground.xml"), "<vector/>");

  write_app_icons(app);

  expect(png_size(readFileSync(join(res, "mipmap-xxxhdpi", "ic_launcher.png")))).toEqual([192, 192]);
  expect(png_size(readFileSync(join(res, "mipmap-mdpi", "ic_launcher_foreground.png")))).toEqual([108, 108]);
  expect(readFileSync(join(res, "mipmap-anydpi-v26", "ic_launcher.xml"), "utf8")).toContain("@mipmap/ic_launcher_foreground");
  expect(existsSync(join(res, "drawable-v24", "ic_launcher_foreground.xml"))).toBe(false);
  expect(readFileSync(join(app, "src/web/public/icon.svg"), "utf8")).toBe(icon);
});

test("an app without resources/icon.svg is told so", () => {
  expect(() => write_app_icons(mkdtempSync(join(tmpdir(), "icons-")))).toThrow(/icon.svg is missing/);
});
