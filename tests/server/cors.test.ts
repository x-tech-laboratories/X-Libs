import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { register_open_cors } from "../../src/server/cors.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

describe("open CORS", () => {
  it("lets any origin call with the client id header", async () => {
    app = fastify();
    await register_open_cors(app, { allowed_headers: ["x-extra"] });
    app.post("/api/call", async () => "ok");
    const preflight = await app.inject({ method: "OPTIONS", url: "/api/call", headers: { origin: "http://localhost", "access-control-request-method": "POST", "access-control-request-headers": "x-client-id" } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    expect(preflight.headers["access-control-allow-methods"]).toBe("GET, POST");
    expect(preflight.headers["access-control-allow-headers"]).toBe("authorization, content-type, x-client-id, x-extra");
    expect(preflight.headers["access-control-max-age"]).toBe("86400");
    const call = await app.inject({ method: "POST", url: "/api/call", headers: { origin: "http://localhost" } });
    expect(call.headers["access-control-allow-origin"]).toBe("*");
  });
});
