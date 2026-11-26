import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { is_plain_path, path_of, route_of } from "../../src/server/request_path.ts";
import { send_raw } from "./raw_request.ts";

let app: FastifyInstance;

afterEach(() => app?.close());

// A server that answers every request with how the path was read.
async function serve(options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  app = Fastify(options);
  app.addHook("onRequest", async (request, reply) => reply.send({ path: path_of(request), route: route_of(request), plain: is_plain_path(request) }));
  app.get("/api/zed", async () => "zed");
  app.get("/api/hosts/:name", async () => "host");
  return app;
}

async function reading(target: string) {
  return JSON.parse((await send_raw(app, "GET", target)).body) as { path: string; route: string | null; plain: boolean };
}

describe("path_of", () => {
  it("reads the path as the router decodes it and names the matched route", async () => {
    await serve();

    expect(await reading("/api/zed?q=%61")).toEqual({ path: "/api/zed", route: "/api/zed", plain: true });
    expect(await reading("/api/hosts/my%20host")).toEqual({ path: "/api/hosts/my host", route: "/api/hosts/:name", plain: true });
    expect(await reading("/api/hosts/a%2Fb")).toEqual({ path: "/api/hosts/a%2Fb", route: "/api/hosts/:name", plain: true });
    expect(await reading("/api/hosts/%2561")).toEqual({ path: "/api/hosts/%2561", route: "/api/hosts/:name", plain: true });
    expect(await reading("/nowhere")).toEqual({ path: "/nowhere", route: null, plain: true });
  });

  it("finds a path read two ways not plain", async () => {
    await serve();

    for (const target of ["/%61pi/zed", "/api/%7Aed", "/api/zed#x", "http://localhost/api/zed", "//api/zed", "/./api/zed", "/api/../api/zed", "/api/hosts/%2e%2e"]) {
      expect(await reading(target), target).toMatchObject({ plain: false });
    }
    expect(await reading("/%61pi/zed")).toEqual({ path: "/api/zed", route: "/api/zed", plain: false });
    expect(await reading("http://localhost/api/zed")).toMatchObject({ path: "/api/zed", route: "/api/zed" });
  });

  it("follows the router's options for semicolons, slashes and case", async () => {
    await serve({ routerOptions: { useSemicolonDelimiter: true, ignoreTrailingSlash: true, ignoreDuplicateSlashes: true, caseSensitive: false } as FastifyServerOptions["routerOptions"] });

    expect(await reading("/api/zed;session=1")).toEqual({ path: "/api/zed", route: "/api/zed", plain: true });
    expect(await reading("/API/Zed/")).toEqual({ path: "/api/zed", route: "/api/zed", plain: true });
  });

  it("is not plain when the path does not begin as the matched route does", () => {
    const request = (url: string, route: string) => ({ url, is404: false, routeOptions: { url: route }, server: { initialConfig: {} } }) as unknown as FastifyRequest;

    expect(is_plain_path(request("/api/hosts/thor", "/api/hosts/:name"))).toBe(true);
    expect(is_plain_path(request("/elsewhere/thor", "/api/hosts/:name"))).toBe(false);
  });
});
