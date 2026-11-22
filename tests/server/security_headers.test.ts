import fastify from "fastify";
import { describe, expect, it } from "vitest";

import { policy_text, register_security_headers, security_headers } from "../../src/server/security_headers.ts";

describe("security_headers", () => {
  it("keeps scripts to the app and forbids framing by default", () => {
    const headers = security_headers();

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("lets the app replace directives, allow its own frames or leave the policy off", () => {
    const replaced = security_headers({ content_security_policy: { "img-src": ["'self'", "https://images.example"] }, allow_same_origin_frames: true });

    expect(replaced["content-security-policy"]).toContain("img-src 'self' https://images.example");
    expect(replaced["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(replaced["x-frame-options"]).toBe("SAMEORIGIN");
    expect(security_headers({ content_security_policy: null })["content-security-policy"]).toBeUndefined();
  });

  it("writes a policy as one header line", () => {
    expect(policy_text({ "default-src": ["'self'"], "object-src": ["'none'"] })).toBe("default-src 'self'; object-src 'none'");
  });
});

describe("register_security_headers", () => {
  it("adds the headers to every answer, keeping any a route sets itself", async () => {
    const app = fastify();
    register_security_headers(app);
    app.get("/", async () => "page");
    app.get("/framed", async (_request, reply) => reply.header("x-frame-options", "SAMEORIGIN").send("framed"));

    const page = await app.inject({ url: "/" });
    const framed = await app.inject({ url: "/framed" });

    expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(page.headers["referrer-policy"]).toBe("same-origin");
    expect(framed.headers["x-frame-options"]).toBe("SAMEORIGIN");
    await app.close();
  });
});
