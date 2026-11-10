#!/usr/bin/env node
// The `x-libs-icons [app folder]` command: every icon an app ships, generated from its one `resources/icon.svg`, as
// the Design Guidelines ask, so no size is ever drawn by hand. It writes the desktop icon, the Android launcher icons
// when the app has an Android project, and the web page's icons when it has a `src/web/public` folder.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Resvg } from "@resvg/resvg-js";

// ── Rendering ────────────────────────────────────────────────────────────────

// The SVG drawn at size by size pixels, scaled to fit; icons hold no text, so the system's fonts, slow to load, are not.
export function render_png(svg: string, size: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: false } }).render().asPng();
}

// The icon centred in a square with margin around it, for Android's adaptive icons, whose foreground is 108dp of which
// only the middle 66dp is sure to show.
export function padded_svg(svg: string, icon_share: number): string {
  const inset = (1 - icon_share) / 2;
  // The icon's own root becomes a nested svg placed in the middle, its width and height replaced.
  const inner = svg
    .replace(/<\?xml[^>]*>/, "")
    .replace(/<svg\b[^>]*>/, (root) => root.replace(/\s(width|height)="[^"]*"/g, "").replace("<svg", `<svg x="${inset}" y="${inset}" width="${icon_share}" height="${icon_share}"`));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${inner}</svg>`;
}

// ── Targets ──────────────────────────────────────────────────────────────────

const android_densities = [
  { folder: "mipmap-mdpi", scale: 1 },
  { folder: "mipmap-hdpi", scale: 1.5 },
  { folder: "mipmap-xhdpi", scale: 2 },
  { folder: "mipmap-xxhdpi", scale: 3 },
  { folder: "mipmap-xxxhdpi", scale: 4 },
];

const adaptive_icon = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by x-libs-icons from resources/icon.svg. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;

const launcher_background = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFFFFF</color>
</resources>
`;

function write(path: string, data: string | Buffer, written: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  written.push(path);
}

// Writes every icon the app has a place for and returns the files written.
export function write_app_icons(app_folder: string): string[] {
  const source = join(app_folder, "resources", "icon.svg");
  if (!existsSync(source)) throw new Error(`no icon to generate from: ${source} is missing`);
  const svg = readFileSync(source, "utf8");
  const written: string[] = [];

  write(join(app_folder, "resources", "icon.png"), render_png(svg, 512), written);

  const res = join(app_folder, "android", "app", "src", "main", "res");
  if (existsSync(res)) {
    // The legacy icons fill a 48dp square; the adaptive foreground puts the 64-unit icon in 108dp, as 22dp margins.
    const foreground = padded_svg(svg, 64 / 108);
    for (const { folder, scale } of android_densities) {
      write(join(res, folder, "ic_launcher.png"), render_png(svg, 48 * scale), written);
      write(join(res, folder, "ic_launcher_round.png"), render_png(svg, 48 * scale), written);
      write(join(res, folder, "ic_launcher_foreground.png"), render_png(foreground, 108 * scale), written);
    }
    write(join(res, "mipmap-anydpi-v26", "ic_launcher.xml"), adaptive_icon, written);
    write(join(res, "mipmap-anydpi-v26", "ic_launcher_round.xml"), adaptive_icon, written);
    write(join(res, "values", "ic_launcher_background.xml"), launcher_background, written);
    // Capacitor's own foreground and background drawables would otherwise be left behind, unused.
    rmSync(join(res, "drawable-v24", "ic_launcher_foreground.xml"), { force: true });
    rmSync(join(res, "drawable", "ic_launcher_background.xml"), { force: true });
  }

  const web = join(app_folder, "src", "web", "public");
  if (existsSync(web)) {
    write(join(web, "icon.svg"), svg, written);
    write(join(web, "icon-192.png"), render_png(svg, 192), written);
    write(join(web, "icon-512.png"), render_png(svg, 512), written);
  }
  return written;
}

// ── Command ──────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const app_folder = resolve(process.argv[2] ?? ".");
  try {
    for (const path of write_app_icons(app_folder)) console.info(`Wrote ${path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
