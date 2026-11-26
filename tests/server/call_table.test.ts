import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { register_call_table } from "../../src/server/call_table.ts";

const is_read_only = (method: string) => method.startsWith("get_");

describe("a table of calls", () => {
  it("answers each call as JSON, plain text included, and tells of changes but not reads", async () => {
    const app = fastify();
    const changed = vi.fn();
    const methods = { get_name: () => "Ada", set_name: (name: string) => void name };
    register_call_table(app, "/api/device", methods, { is_read_only, on_change: changed });

    const read = await app.inject({ method: "POST", url: "/api/device/get_name", payload: [] });
    const write = await app.inject({ method: "POST", url: "/api/device/set_name", payload: ["Grace"], headers: { "x-client-id": "window" } });

    expect(read.headers["content-type"]).toContain("application/json");
    expect(read.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(read.body)).toBe("Ada");
    expect(write.statusCode).toBe(204);
    expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.calls[0]!.slice(0, 2)).toEqual(["window", "set_name"]);
    await app.close();
  });

  it("refuses a call the table lacks, its prototype's included, and arguments not in a list", async () => {
    const app = fastify();
    register_call_table(app, "/calls", { get_name: () => "Ada" }, { is_read_only });

    const missing = await app.inject({ method: "POST", url: "/calls/nope", payload: [] });
    const inherited = await app.inject({ method: "POST", url: "/calls/toString", payload: [] });
    const named = await app.inject({ method: "POST", url: "/calls/get_name", payload: { name: "Ada" } });
    const empty = await app.inject({ method: "POST", url: "/calls/get_name" });

    expect(missing.statusCode).toBe(404);
    expect(inherited.statusCode).toBe(404);
    expect(named.statusCode).toBe(400);
    expect(JSON.parse(empty.body)).toBe("Ada");
    await app.close();
  });

  it("takes arguments by name for a call whose names it is given, and a list as before", async () => {
    const app = fastify();
    const methods = { greet: (name: string, greeting = "Hello") => `${greeting}, ${name}`, get_count: (n: number) => n };
    register_call_table(app, "/calls", methods, { is_read_only, params: { greet: { params: [{ name: "name" }, { name: "greeting", optional: true }] } } });

    const named = await app.inject({ method: "POST", url: "/calls/greet", payload: { name: "Ada" } });
    const both = await app.inject({ method: "POST", url: "/calls/greet", payload: { greeting: "Hi", name: "Ada" } });
    const listed = await app.inject({ method: "POST", url: "/calls/greet", payload: ["Ada", "Hey"] });
    const unknown = await app.inject({ method: "POST", url: "/calls/greet", payload: { nom: "Ada" } });
    const missing = await app.inject({ method: "POST", url: "/calls/greet", payload: {} });
    const unnamed = await app.inject({ method: "POST", url: "/calls/get_count", payload: { n: 1 } });
    const text = await app.inject({ method: "POST", url: "/calls/greet", payload: '"Ada"', headers: { "content-type": "application/json" } });

    expect(JSON.parse(named.body)).toBe("Hello, Ada");
    expect(JSON.parse(both.body)).toBe("Hi, Ada");
    expect(JSON.parse(listed.body)).toBe("Hey, Ada");
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toContain("unknown argument nom");
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain("missing argument name");
    expect(unnamed.statusCode).toBe(400);
    expect(unnamed.body).toContain("JSON list");
    expect(text.statusCode).toBe(400);
    expect(text.body).toContain("JSON list or object");
    await app.close();
  });

  it("takes no names from the table's prototype", async () => {
    const app = fastify();
    register_call_table(app, "/calls", { toString: () => "own" }, { is_read_only, params: {} });

    const named = await app.inject({ method: "POST", url: "/calls/toString", payload: {} });

    expect(named.statusCode).toBe(400);
    await app.close();
  });
});
