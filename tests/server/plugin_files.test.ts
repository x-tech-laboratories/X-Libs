import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { register_plugin_files } from "../../src/server/plugin_files.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

function plugins_folder(): string {
  const root = mkdtempSync(join(tmpdir(), "x-libs-plugin-files-"));
  mkdirSync(join(root, "hello", "dist"), { recursive: true });
  writeFileSync(join(root, "hello", "package.json"), JSON.stringify({ "x-plugin": { web: "dist/web.js", server: "dist/server.js" } }));
  writeFileSync(join(root, "hello", "dist", "web.js"), "export default {}");
  writeFileSync(join(root, "hello", "dist", "server.js"), "export default {}");
  writeFileSync(join(root, "secret.txt"), "not a plugin");
  return root;
}

describe("plugin files", () => {
  it("lists the web entries relative to the list and serves their files as scripts", async () => {
    app = fastify();
    register_plugin_files(app, { folder: plugins_folder() });

    const index = await app.inject({ method: "GET", url: "/plugins/index.json" });
    expect(index.json()).toEqual({ entries: ["hello/dist/web.js"], problems: [] });

    const entry = await app.inject({ method: "GET", url: "/plugins/hello/dist/web.js" });
    expect(entry.statusCode).toBe(200);
    expect(entry.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(entry.body).toBe("export default {}");
  });

  it("serves nothing outside a plugin's own subfolder", async () => {
    app = fastify();
    register_plugin_files(app, { folder: plugins_folder(), prefix: "/extra/" });

    for (const url of ["/extra/hello/../secret.txt", "/extra/hello/%2e%2e/secret.txt", "/extra/..%2fsecret.txt/x", "/extra/hello/dist", "/extra/missing/web.js"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(404);
    }
  });

  it("lists nothing when the folder does not exist yet", async () => {
    app = fastify();
    register_plugin_files(app, { folder: join(tmpdir(), "x-libs-no-plugins-here") });

    expect((await app.inject({ method: "GET", url: "/plugins/index.json" })).json()).toEqual({ entries: [], problems: [] });
  });
});
