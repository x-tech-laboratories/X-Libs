import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { names_of, new_app_files, parse_new_app_args, write_new_app, type NewAppOptions } from "../src/app_new.ts";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const options: NewAppOptions = { name: "X-Media-Notes", port: 7790, desktop: true, android: true };

describe("x-app-new", () => {
  it("names the app's package, variables, files and Android id from its name", () => {
    expect(names_of("X-Media-Notes")).toEqual({ name: "X-Media-Notes", slug: "x-media-notes", env_prefix: "X_MEDIA_NOTES", short: "media-notes", app_id: "com.xtechlaboratories.xmedianotes" });
    expect(() => names_of("Notes")).toThrow("not an X-app name");
  });

  it("lays the app out as the standard asks, on X-App's base, presets, Nix lib and actions", () => {
    const files = new_app_files(options);
    const manifest = JSON.parse(files["package.json"]!) as { name: string; license: string; dependencies: Record<string, string>; scripts: Record<string, string> };

    expect(Object.keys(files)).toEqual(expect.arrayContaining(["src/app.ts", "src/server/main.ts", "src/daemon/main.ts", "src/main/index.ts", "src/preload/index.ts", "src/web/main.tsx", "tests/app.test.ts", "config/tsconfig.base.json", "config/vite.config.ts", "config/vitest.config.ts", "nix/flake.nix", "nix/shell.nix", ".github/workflows/ci.yml", "LICENSE"]));
    expect(manifest).toMatchObject({ name: "x-media-notes", license: "GPL-3.0-or-later" });
    expect(manifest.dependencies["@x-tech-laboratories/x-app"]).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(Object.keys(manifest.scripts)).toEqual(expect.arrayContaining(["dev:server", "dev:web", "dev", "build", "start", "test", "coverage", "lint"]));
    expect(files["src/app.ts"]).toContain('env_prefix: "X_MEDIA_NOTES"');
    expect(files["src/app.ts"]).toContain("ports: { server: 7790, peer: 7791 }");
    expect(files["config/tsconfig.base.json"]).toContain("@x-tech-laboratories/x-app/config/tsconfig/base.json");
    expect(files["nix/flake.nix"]).toContain("x-app.lib.desktop_package pkgs app");
    expect(files[".github/workflows/ci.yml"]).toContain("x-tech-laboratories/X-App/.github/actions/app-ci@main");
  });

  it("leaves out what a web-only app has no use for", () => {
    const files = new_app_files({ ...options, desktop: false, android: false });

    expect(Object.keys(files).filter((path) => /src\/(main|preload|daemon)|electron|android|capacitor/.test(path))).toEqual([]);
    expect(files["nix/flake.nix"]).not.toContain("desktop_package");
    expect(files[".github/workflows/ci.yml"]).toContain("targets: ./nix#default\n");
    expect(JSON.parse(files["package.json"]!).devDependencies).not.toHaveProperty("electron");
  });

  it("writes the app into a new folder and never over one that holds an app", () => {
    const folder = mkdtempSync(join(tmpdir(), "x-app-new-"));
    folders.push(folder);

    const written = write_new_app(folder, options);

    expect(written.length).toBe(Object.keys(new_app_files(options)).length);
    expect(existsSync(join(folder, "src/web/notes/NotesView.tsx"))).toBe(true);
    expect(readFileSync(join(folder, "LICENSE"), "utf8")).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(() => write_new_app(folder, options)).toThrow("already holds an app");
  });

  it("reads its command line, with a port and targets left out", () => {
    expect(parse_new_app_args(["X-Notes"]).options).toEqual({ name: "X-Notes", port: 7800, desktop: true, android: true });
    expect(parse_new_app_args(["X-Notes", "--port", "7810", "--no-android", "--folder", "/tmp/notes"])).toEqual({ folder: "/tmp/notes", options: { name: "X-Notes", port: 7810, desktop: true, android: false } });
    expect(() => parse_new_app_args([])).toThrow("Usage");
    expect(() => parse_new_app_args(["X-Notes", "--port", "80"])).toThrow("not a port");
  });
});
