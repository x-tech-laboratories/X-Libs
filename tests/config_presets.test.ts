import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Plugin } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { capacitor_stand_in, has_package } from "../src/config/capacitor.ts";
import { desktop_vite_config } from "../src/config/electron_vite.ts";
import { android_content_policy, android_vite_config, web_vite_config } from "../src/config/vite.ts";
import { vitest_config } from "../src/config/vitest.ts";

afterEach(() => vi.unstubAllEnvs());

// ============================================================================
// Vite
// ============================================================================

describe("vite presets", () => {
  it("builds the browser's page from src/web into out/web, its dev API sent to the server's port", () => {
    const config = web_vite_config({ port: 7740 });

    expect(config).toMatchObject({ root: "src/web", base: "./", build: { outDir: "../../out/web" } });
    expect(config.server?.proxy).toEqual({ "/api/": "http://127.0.0.1:7740", "/login": "http://127.0.0.1:7740" });
  });

  it("sends the dev API to the port PORT names", () => {
    vi.stubEnv("PORT", "9000");
    expect(web_vite_config({ port: 7740 }).server?.proxy).toMatchObject({ "/api/": "http://127.0.0.1:9000" });
  });

  it("stands in for Capacitor in an app that lacks it, and leaves an app that has it to the real one", () => {
    const without = mkdtempSync(join(tmpdir(), "x-app-no-capacitor-"));
    writeFileSync(join(without, "package.json"), "{}");
    const stand_in = capacitor_stand_in(without);
    const resolve_id = stand_in.resolveId as (source: string) => string | null;
    const load = stand_in.load as (id: string) => string | null;

    const core = resolve_id("@capacitor/core")!;

    expect(core).toContain("@capacitor/core");
    expect(load(core)).toContain("export function registerPlugin");
    expect(load(resolve_id("@capacitor/app")!)).toContain("export const App");
    expect(resolve_id("react")).toBeNull();
    expect(load("react")).toBeNull();
    expect((capacitor_stand_in().resolveId as (source: string) => string | null)("@capacitor/core")).toBeNull();
    expect(has_package(process.cwd(), "@capacitor/core")).toBe(true);
    expect((capacitor_stand_in(process.cwd()).resolveId as (source: string) => string | null)("@capacitor/core")).toBeNull();
    expect((web_vite_config({ port: 7740 }).plugins as Plugin[]).map((plugin) => plugin.name)).toContain("x-app-capacitor-stand-in");
  });

  it("builds the phone's page into out/android with a content policy that lets SQLite and sync run", () => {
    const config = android_vite_config();
    const policy = (config.plugins as Plugin[]).find((plugin) => plugin.name === "x-app-android-content-policy")!;
    const page = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />';

    const rewritten = (policy.transformIndexHtml as (html: string) => string)(page);

    expect(config).toMatchObject({ mode: "android", build: { outDir: "../../out/android" } });
    expect(rewritten).toContain(android_content_policy);
    expect(android_content_policy).toContain("'wasm-unsafe-eval'");
  });
});

// ============================================================================
// electron-vite
// ============================================================================

describe("electron-vite preset", () => {
  it("builds the window, the daemon beside it, the preload and the page", () => {
    const config = desktop_vite_config();

    expect(config.main?.build?.rollupOptions?.input).toEqual({ index: resolve("src/main/index.ts"), daemon: resolve("src/daemon/main.ts") });
    expect(config.preload?.build?.rollupOptions?.input).toEqual({ index: resolve("src/preload/index.ts") });
    expect(config.renderer?.root).toBe(resolve("src/web"));
  });

  it("leaves the daemon out of an app that has none", () => {
    expect(desktop_vite_config({ daemon: null }).main?.build?.rollupOptions?.input).toEqual({ index: resolve("src/main/index.ts") });
  });
});

// ============================================================================
// Vitest and TypeScript
// ============================================================================

describe("vitest preset", () => {
  it("runs tests/ in UTC and reports coverage of src/ to the terminal only", () => {
    const config = vitest_config();

    expect(process.env.TZ).toBe("UTC");
    expect(config.test?.include).toEqual(["tests/**/*.test.ts", "tests/**/*.test.tsx"]);
    expect(config.test?.coverage).toMatchObject({ provider: "v8", include: ["src/**/*.{ts,tsx}"], reporter: ["text"] });
  });
});

describe("tsconfig presets", () => {
  const read = (name: string) => JSON.parse(readFileSync(resolve("config/tsconfig", name), "utf8")) as { extends?: string; compilerOptions: Record<string, unknown> };

  it("hold the standard's strict flags once, which every target extends", () => {
    expect(read("base.json").compilerOptions).toMatchObject({ strict: true, allowImportingTsExtensions: true, verbatimModuleSyntax: true, erasableSyntaxOnly: true, noEmit: true });
    for (const target of ["node.json", "web.json", "tests.json"]) expect(read(target).extends).toBe("./base.json");
    expect(read("web.json").compilerOptions).toMatchObject({ jsx: "react-jsx", types: ["vite/client"] });
    expect(read("node.json").compilerOptions).toMatchObject({ types: ["node"] });
  });
});
