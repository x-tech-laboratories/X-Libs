import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { BAD_JSON, register_error_replies, register_lenient_json_body, send_text } from "../../src/server/replies.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

describe("error replies", () => {
  it("answers errors and unknown paths in plain text, logging only the server's own failures", async () => {
    app = fastify();
    const logged: string[] = [];
    register_error_replies(app, { log_failure: (message) => logged.push(message) });
    app.get("/refused", async () => {
      throw Object.assign(new Error("not yours"), { statusCode: 403 });
    });
    app.get("/broken", async () => {
      throw new Error("the disk is gone");
    });

    const refused = await app.inject({ method: "GET", url: "/refused" });
    expect(refused.statusCode).toBe(403);
    expect(refused.headers["content-type"]).toContain("text/plain");
    expect(refused.body).toBe("not yours");

    const broken = await app.inject({ method: "GET", url: "/broken" });
    expect(broken.statusCode).toBe(500);
    expect(broken.body).toBe("the disk is gone");
    expect(logged).toEqual(["GET /broken failed:"]);

    const missing = await app.inject({ method: "GET", url: "/nothing" });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toBe("not found");
  });

  it("answers as JSON when asked and leaves unknown paths to the app", async () => {
    app = fastify();
    register_error_replies(app, { format: "json", not_found: false });
    app.setNotFoundHandler(async (_request, reply) => send_text(reply, 404, "the app's own"));
    app.get("/broken", async () => {
      throw Object.assign(new Error("bad field"), { statusCode: 400 });
    });
    const broken = await app.inject({ method: "GET", url: "/broken" });
    expect(broken.json()).toEqual({ error: "bad field" });
    expect((await app.inject({ method: "GET", url: "/nothing" })).body).toBe("the app's own");
  });
});

describe("lenient JSON body", () => {
  it("reads an empty body as no arguments and a bad one as the marker", async () => {
    app = fastify();
    register_lenient_json_body(app);
    app.post("/call", async (request) => {
      if (request.body === BAD_JSON) return "bad";
      if (request.body === undefined) return "empty";
      return JSON.stringify(request.body);
    });
    const headers = { "content-type": "application/json" };
    expect((await app.inject({ method: "POST", url: "/call", headers, payload: "" })).body).toBe("empty");
    expect((await app.inject({ method: "POST", url: "/call", headers, payload: "{nope" })).body).toBe("bad");
    expect((await app.inject({ method: "POST", url: "/call", headers, payload: "[1,2]" })).body).toBe("[1,2]");
  });
});
