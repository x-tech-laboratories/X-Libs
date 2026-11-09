import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { load_plugin_folder, plugin_entries } from "../src/plugin_folder.ts";

function plugin_dir(root: string, name: string, sides: unknown, files: Record<string, string> = {}): void {
  mkdirSync(join(root, name), { recursive: true });
  if (sides !== undefined) writeFileSync(join(root, name, "package.json"), JSON.stringify({ name, type: "module", "x-plugin": sides }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, name, path, ".."), { recursive: true });
    writeFileSync(join(root, name, path), text);
  }
}

const PLUGIN = `export default { id: "x.hello", name: "Hello", version: "1.0.0", start() {} };`;

describe("plugin folder", () => {
  it("finds each subfolder's entry for a side and skips one that has none", () => {
    const root = mkdtempSync(join(tmpdir(), "x-libs-plugins-"));
    plugin_dir(root, "hello", { server: "dist/server.js", web: "dist/web.js" }, { "dist/server.js": PLUGIN, "dist/web.js": PLUGIN });
    plugin_dir(root, "web-only", { web: "web.js" }, { "web.js": PLUGIN });

    expect(plugin_entries(root, "server").entries.map(({ name, path }) => [name, path])).toEqual([["hello", "dist/server.js"]]);
    expect(plugin_entries(root, "web").entries.map(({ name }) => name).sort()).toEqual(["hello", "web-only"]);
  });

  it("reports a subfolder without a package.json, an entry outside its folder and one not built", () => {
    const root = mkdtempSync(join(tmpdir(), "x-libs-plugins-"));
    plugin_dir(root, "bare", undefined, { "index.js": PLUGIN });
    plugin_dir(root, "escape", { server: "../bare/index.js" });
    plugin_dir(root, "unbuilt", { server: "dist/server.js" });
    plugin_dir(root, "linked", { server: "out.js" });
    symlinkSync(join(root, "bare", "index.js"), join(root, "linked", "out.js"));

    const problems = Object.fromEntries(plugin_entries(root, "server").problems.map(({ name, problem }) => [name, problem]));
    expect(problems).toEqual({
      bare: "It has no package.json.",
      escape: "Its server entry ../bare/index.js is outside its folder.",
      unbuilt: "Its server entry dist/server.js is missing; is it built?",
      linked: "Its server entry out.js is outside its folder.",
    });
  });

  it("imports each entry's plugin and reports one that exports none", async () => {
    const root = mkdtempSync(join(tmpdir(), "x-libs-plugins-"));
    plugin_dir(root, "hello", { server: "server.js" }, { "server.js": PLUGIN });
    plugin_dir(root, "named", { server: "server.mjs" }, { "server.mjs": `export const plugin = { id: "x.named", name: "Named", version: "1.0.0", start() {} };` });
    plugin_dir(root, "empty", { server: "server.js" }, { "server.js": "export const nothing = 1;" });

    const { plugins, problems } = await load_plugin_folder(root, "server");
    expect(plugins.map((plugin) => plugin.id).sort()).toEqual(["x.hello", "x.named"]);
    expect(problems).toEqual([{ name: "empty", problem: "Its server entry exports no plugin." }]);
  });

  it("finds nothing in a folder that does not exist", async () => {
    expect(await load_plugin_folder(join(tmpdir(), "x-libs-no-such-folder"), "server")).toEqual({ plugins: [], problems: [] });
  });
});
