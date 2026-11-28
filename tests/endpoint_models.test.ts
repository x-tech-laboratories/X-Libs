import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { list_endpoint_models, may_load, model_label, models_of, most_models, state_of } from "../src/endpoint_models.ts";

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

// A server answering GET /v1/models with what `answer` gives, keeping each request's authorization.
async function models_server(answer: () => { status?: number; body: string }): Promise<{ endpoint: string; authorizations: string[] }> {
  const authorizations: string[] = [];
  const server: Server = createServer((request, response) => {
    authorizations.push(String(request.headers.authorization ?? ""));
    if (request.method !== "GET" || request.url !== "/v1/models") return void response.writeHead(404).end();
    const { status = 200, body } = answer();
    response.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, authorizations };
}

// A port nothing listens on, found by opening and closing a server.
async function closed_port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const router_answer = JSON.stringify({
  object: "list",
  data: [
    { id: "qwen3.6-35b-a3b", object: "model", owned_by: "llamacpp", in_cache: true, status: { value: "loaded", args: [] } },
    { id: "bonsai-2.5-27b", object: "model", owned_by: "llamacpp", status: { value: "unloaded" } },
    { id: "inkling-2-mini", object: "model", status: { value: "loading" } },
  ],
});

describe("listing an endpoint's models", () => {
  it("lists an OpenAI-format answer, sending the key only as a bearer token", async () => {
    const server = await models_server(() => ({ body: JSON.stringify({ data: [{ id: "gpt-a" }, { id: "gpt-b" }, { id: "gpt-a" }, { nope: 1 }] }) }));
    expect(await list_endpoint_models(`${server.endpoint}/`, "sk-secret-key")).toEqual({
      models: [
        { id: "gpt-a", state: "" },
        { id: "gpt-b", state: "" },
      ],
      problem: "",
    });
    expect(server.authorizations).toEqual(["Bearer sk-secret-key"]);
    await list_endpoint_models(server.endpoint, "", new AbortController().signal);
    expect(server.authorizations[1]).toBe("");
  });

  it("keeps what a llama.cpp router says of each model's load state", async () => {
    const server = await models_server(() => ({ body: router_answer }));
    const listing = await list_endpoint_models(server.endpoint, "");
    expect(listing.models).toEqual([
      { id: "qwen3.6-35b-a3b", state: "loaded" },
      { id: "bonsai-2.5-27b", state: "unloaded" },
      { id: "inkling-2-mini", state: "loading" },
    ]);
    expect(state_of({ status: "loaded" })).toBe("loaded");
    expect(state_of({ status: { value: "odd", failed: true } })).toBe("failed");
    expect(state_of({ loaded: false })).toBe("unloaded");
    expect(state_of({ loaded: true })).toBe("loaded");
    expect(state_of({ status: 3 })).toBe("");
    expect(models_of({ data: "no" })).toBeNull();
    expect(models_of({ data: Array.from({ length: most_models + 5 }, (_, at) => ({ id: `m${at}` })) })).toHaveLength(most_models);
    expect(models_of({ data: [{ id: " " }, { id: "x".repeat(201) }] })).toEqual([]);
  });

  it("gives no list, saying why in words that never hold the key, when the endpoint fails", async () => {
    let answer = { status: 500, body: "sk-secret-key went wrong" };
    const server = await models_server(() => answer);
    const host = new URL(server.endpoint).host;
    expect(await list_endpoint_models(server.endpoint, "sk-secret-key")).toEqual({ models: [], problem: `${host} does not list its models (it answered 500).` });
    answer = { status: 401, body: "" };
    expect((await list_endpoint_models(server.endpoint, "sk-secret-key")).problem).toBe(`${host} refused the API key when asked for its models.`);
    answer = { status: 200, body: "not json" };
    expect((await list_endpoint_models(server.endpoint, "")).problem).toBe(`${host} answered, but not with a list of models.`);
    answer = { status: 200, body: JSON.stringify({ data: [] }) };
    expect((await list_endpoint_models(server.endpoint, "")).problem).toBe(`${host} lists no models.`);
    const port = await closed_port();
    expect(await list_endpoint_models(`http://127.0.0.1:${port}/v1`, "sk-secret-key")).toEqual({ models: [], problem: `127.0.0.1:${port} could not be reached to list its models.` });
    expect((await list_endpoint_models("nowhere", "", undefined, async () => Promise.reject(new Error("no")))).problem).toBe("the endpoint could not be reached to list its models.");
  });
});

describe("showing a listed model", () => {
  it("labels a model with its load state, and knows when it may have to load", () => {
    const listing = { problem: "", models: [{ id: "a", state: "loaded" as const }, { id: "b", state: "" as const }, { id: "c", state: "unloaded" as const }] };
    expect(may_load(listing, "a", true)).toBe(false);
    expect(may_load(listing, "b", true)).toBe(true);
    expect(may_load(listing, "b", false)).toBe(false);
    expect(may_load(listing, "c", false)).toBe(true);
    expect(may_load(null, "c", false)).toBe(false);
    expect(model_label({ id: "x", state: "failed" })).toBe("x (failed to load)");
    expect(model_label({ id: "y", state: "" })).toBe("y");
  });
});
