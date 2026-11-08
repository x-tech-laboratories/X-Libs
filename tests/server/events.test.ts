import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { EventStream } from "../../src/server/events.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

async function open_stream(url: string): Promise<{ read: () => Promise<string>; close: () => void }> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  return {
    read: async () => decoder.decode((await reader.read()).value),
    close: () => controller.abort(),
  };
}

async function wait_for(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !check(); tries++) await new Promise((wake) => setTimeout(wake, 10));
  expect(check()).toBe(true);
}

describe("event stream", () => {
  it("greets each client with its id, announces changes to the others and ends with the app", async () => {
    app = fastify({ forceCloseConnections: true });
    const stream = new EventStream({ heartbeat_ms: 60_000 });
    stream.register(app, "/api/events");
    app.post("/api/change", async (request, reply) => {
      stream.announce_change(stream.client_id_of(request));
      return reply.code(204).send();
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });

    const first = await open_stream(`${address}/api/events`);
    const second = await open_stream(`${address}/api/events`);
    const first_hello = await first.read();
    const second_hello = await second.read();
    expect(first_hello).toContain("retry: 3000\n\n");
    const first_id = /event: hello\ndata: (.+)\n/.exec(first_hello)![1];
    expect(second_hello).toContain("event: hello");
    expect(stream.client_count).toBe(2);

    await fetch(`${address}/api/change`, { method: "POST", headers: { "x-client-id": first_id } });
    expect(await second.read()).toBe("event: changed\ndata: \n\n");

    stream.send("line one\nline two", { event: "note", except_client_id: "nobody" });
    expect(await first.read()).toBe("event: note\ndata: line one\ndata: line two\n\n");
    expect(await second.read()).toBe("event: note\ndata: line one\ndata: line two\n\n");

    first.close();
    await wait_for(() => stream.client_count === 1);
    await app.close();
    expect(stream.client_count).toBe(0);
    second.close();
  });

  it("sends nameless events to chosen clients and no greeting when asked", async () => {
    app = fastify({ forceCloseConnections: true });
    const stream = new EventStream({ hello_event: null, retry_ms: 5000, heartbeat_ms: 60_000 });
    stream.register(app, "/api/stream");
    const address = await app.listen({ port: 0, host: "127.0.0.1" });

    const viewer = await open_stream(`${address}/api/stream?who=viewer`);
    const admin = await open_stream(`${address}/api/stream?who=admin`);
    expect(await viewer.read()).toBe("retry: 5000\n\n");
    expect(await admin.read()).toBe("retry: 5000\n\n");
    await wait_for(() => stream.client_count === 2);

    stream.send(JSON.stringify({ kind: "run" }), { to: ({ request }) => request.url.endsWith("admin") });
    expect(await admin.read()).toBe('data: {"kind":"run"}\n\n');
    stream.send("for all");
    expect(await viewer.read()).toBe("data: for all\n\n");
    expect(await admin.read()).toBe("data: for all\n\n");
    viewer.close();
    admin.close();
  });

  it("sends a heartbeat comment", async () => {
    app = fastify({ forceCloseConnections: true });
    const stream = new EventStream({ heartbeat_ms: 20, hello_event: null });
    stream.register(app);
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = await open_stream(`${address}/events`);
    await client.read();
    expect(await client.read()).toBe(": still here\n\n");
    client.close();
  });
});
