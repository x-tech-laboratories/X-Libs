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
});
