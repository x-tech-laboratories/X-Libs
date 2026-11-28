import { describe, expect, it } from "vitest";

import { default_embeddings_endpoint, embeddings_client, type EmbeddingsSettings } from "../src/embeddings.ts";
import { PlainFailure } from "../src/endpoints.ts";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { model: string; input: string[] };
}

// A fetch answering as an embeddings endpoint would, each text's vector its length and index.
function fake_endpoint(answer?: (sent: Sent) => Response) {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const request = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Sent["body"] };
    sent.push(request);
    if (answer) return answer(request);
    const data = request.body.input.map((text, index) => ({ index, embedding: [text.length, index] })).reverse();
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
  return { sent, fetcher };
}

describe("an embeddings client", () => {
  it("embeds texts in order on the endpoint set, with the key as a bearer token", async () => {
    const { sent, fetcher } = fake_endpoint();
    const client = embeddings_client(() => ({ endpoint: "http://192.168.1.9:11434/v1/", model: " nomic ", dimensions: 2, query_prefix: "search:\\n" }), { fetcher, api_key: async () => "made-up-key" });
    expect(await client.embed(["one", "three"])).toEqual([
      [3, 0],
      [5, 1],
    ]);
    expect(sent[0]).toMatchObject({ url: "http://192.168.1.9:11434/v1/embeddings", body: { model: "nomic", input: ["one", "three"] } });
    expect(sent[0]!.headers.authorization).toBe("Bearer made-up-key");
    expect(await client.embed_query("tiles")).toEqual([13, 0]);
    expect(sent[1]!.body.input).toEqual(["search:\ntiles"]);
    expect(await client.embed([])).toEqual([]);
    expect(client.is_local()).toBe(true);
    expect(client.model()).toBe("nomic");
  });

  it("uses Ollama's endpoint and 768 numbers unless set, and sends no key without one", async () => {
    const { sent, fetcher } = fake_endpoint(() => new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0) }] })));
    const client = embeddings_client(() => ({ model: "m" }), { fetcher });
    expect(client.dimensions()).toBe(768);
    expect(await client.embed(["x"])).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${default_embeddings_endpoint}/embeddings`);
    expect(sent[0]!.headers.authorization).toBeUndefined();
  });

  it("refuses an answer that does not fit, and says failures plainly", async () => {
    const settings: EmbeddingsSettings = { endpoint: "https://embed.example/v1", model: "m", dimensions: 3 };
    const words = { settings: "Settings → Index", rate_limit_advice: "Indexing tries again later." };
    const answering = (response: () => Response) => embeddings_client(() => settings, { fetcher: fake_endpoint(response).fetcher, words });
    await expect(embeddings_client(() => ({ ...settings, model: "" }), { words }).embed(["x"])).rejects.toThrow("Set the embedding model under Settings → Index.");
    await expect(answering(() => new Response(JSON.stringify({ data: [] }))).embed(["x"])).rejects.toThrow("gave 0 vectors for 1 texts");
    await expect(answering(() => new Response(JSON.stringify({ data: [{ embedding: ["a"] }] }))).embed(["x"])).rejects.toThrow("something other than a list of numbers");
    await expect(answering(() => new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }))).embed(["x"])).rejects.toThrow("The model gives vectors of 2 numbers, not the 3 set under Settings → Index.");
    const limited = answering(() => new Response("slow down", { status: 429, statusText: "Too Many Requests" })).embed(["x"]);
    await expect(limited).rejects.toBeInstanceOf(PlainFailure);
    await expect(limited).rejects.toMatchObject({
      message: "The embedder at embed.example:443 is limiting how often it is asked. Indexing tries again later.",
      detail: "The embeddings endpoint answered 429 Too Many Requests. slow down",
    });
    const unreachable = embeddings_client(() => settings, { fetcher: (async () => Promise.reject(new Error("fetch failed"))) as unknown as typeof fetch, words });
    await expect(unreachable.embed(["x"])).rejects.toThrow("The embedder at embed.example:443 cannot be reached. Check that its server is running and that its endpoint under Settings → Index is right.");
    expect(unreachable.is_local()).toBe(false);
  });

  it("lets a stopped request end as stopped", async () => {
    const stop = new AbortController();
    stop.abort();
    const stopped = new Error("This operation was aborted");
    const client = embeddings_client(() => ({ model: "m" }), { fetcher: (async () => Promise.reject(stopped)) as unknown as typeof fetch });
    await expect(client.embed(["x"], stop.signal)).rejects.toBe(stopped);
  });
});
