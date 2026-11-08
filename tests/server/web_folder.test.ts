import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register_web_folder } from "../../src/server/web_folder.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
});

function built_page(): string {
  const folder = mkdtempSync(join(tmpdir(), "x-libs-web-"));
  writeFileSync(join(folder, "index.html"), "<!doctype html><title>page</title>");
  mkdirSync(join(folder, "assets"));
  writeFileSync(join(folder, "assets", "index-abc123.js"), "console.log(1)");
  return folder;
}

describe("web folder", () => {
  it("serves the page fresh each time and the hashed bundles for a year, with no etag or date", async () => {
    app = fastify();
    expect(await register_web_folder(app, { folder: built_page() })).toBe(true);
    app.get("/api/things", async () => []);

    const page = await app.inject({ method: "GET", url: "/index.html" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-cache");
    expect(page.headers.etag).toBeUndefined();
    expect(page.headers["last-modified"]).toBeUndefined();

    const bundle = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    expect((await app.inject({ method: "GET", url: "/anything/else" })).statusCode).toBe(404);
  });

  it("warns and serves only the API when the folder is missing, or throws when asked", async () => {
    app = fastify();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await register_web_folder(app, { folder: "/nowhere/at/all" })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    await expect(register_web_folder(app, { folder: "/nowhere/at/all", when_missing: "throw" })).rejects.toThrow("not built");
    const quiet = await register_web_folder(app, { folder: "/nowhere/at/all", when_missing: "skip" });
    expect(quiet).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("hands unknown page paths the page and unknown API paths a refusal", async () => {
    app = fastify();
    await register_web_folder(app, { folder: built_page(), page_fallback: true, page_cache_control: "no-cache, no-store", api_not_found: (_request, reply) => reply.code(404).send({ error: "Not found" }) });

    const page = await app.inject({ method: "GET", url: "/repositories/one" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>page</title>");
    expect(page.headers["cache-control"]).toBe("no-cache, no-store");

    const call = await app.inject({ method: "GET", url: "/api/nothing" });
    expect(call.statusCode).toBe(404);
    expect(call.json()).toEqual({ error: "Not found" });
    expect((await app.inject({ method: "POST", url: "/somewhere" })).statusCode).toBe(404);
  });
});
