// A client for any OpenAI-compatible embeddings endpoint, Ollama's on this computer unless set otherwise: texts in,
// one vector each out, checked against the size the settings expect, its failures in plain words. Its key is asked
// for afresh on each call and dropped with it. Needs only fetch, so it runs in a page as on Node.

// ── Imports ──────────────────────────────────────────────────────────────────

import { PlainFailure, explain_endpoint_failure, is_local_endpoint, type EndpointWhere } from "./endpoints.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export const default_embeddings_endpoint = "http://localhost:11434/v1";

export const default_dimensions = 768;

export interface EmbeddingsSettings {
  // The endpoint, ending in /v1; Ollama's on this computer when empty.
  endpoint?: string;
  // The model's name on that endpoint, such as "nomic-embed-text".
  model: string;
  // How many numbers each vector holds; 768 unless set.
  dimensions?: number;
  // Put before a search, for a model that wants an instruction there; a literal \n in it is a newline.
  query_prefix?: string;
}

export interface EmbeddingsOptions {
  // The key sent as a bearer token; none unless given.
  api_key?: () => Promise<string>;
  fetcher?: typeof fetch;
  // How failures are said, such as where the settings are; the label is "embedder" unless given.
  words?: Omit<EndpointWhere, "endpoint" | "default_endpoint" | "model">;
}

export interface EmbeddingsClient {
  model(): string;
  dimensions(): number;
  // True when the endpoint is on this computer or its network.
  is_local(): boolean;
  // One vector per text, in the same order.
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  // The vector of a search, with the query prefix before it.
  embed_query(query: string, signal?: AbortSignal): Promise<number[]>;
}

// ── Client ───────────────────────────────────────────────────────────────────

export function embeddings_endpoint(settings: EmbeddingsSettings): string {
  return (String(settings.endpoint ?? "").trim() || default_embeddings_endpoint).replace(/\/+$/, "");
}

// An embeddings client on the endpoint the settings name now, read again on every call.
export function embeddings_client(settings: () => EmbeddingsSettings, options: EmbeddingsOptions = {}): EmbeddingsClient {
  const fetcher = options.fetcher ?? fetch;
  const under = options.words?.settings ? ` under ${options.words.settings}` : "";
  const model = () => String(settings().model ?? "").trim();
  const dimensions = () => Number(settings().dimensions) || default_dimensions;
  const query_prefix = () => String(settings().query_prefix ?? "").replace(/\\n/g, "\n");
  const client: EmbeddingsClient = {
    model,
    dimensions,
    is_local: () => is_local_endpoint(embeddings_endpoint(settings())),
    async embed(texts, signal) {
      if (texts.length === 0) return [];
      if (!model()) throw new Error(`Set the embedding model${under}.`);
      const api_key = options.api_key ? await options.api_key() : "";
      const endpoint = embeddings_endpoint(settings());
      const failure = (error: unknown) => {
        const { message, detail } = explain_endpoint_failure(error, {
          label: "embedder",
          serves: "embeddings",
          keep_unknown: true,
          ...options.words,
          endpoint,
          default_endpoint: default_embeddings_endpoint,
          model: model(),
        });
        return new PlainFailure(message, detail);
      };
      let response: Response;
      try {
        response = await fetcher(`${endpoint}/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(api_key ? { authorization: `Bearer ${api_key}` } : {}) },
          body: JSON.stringify({ model: model(), input: texts }),
          signal: signal ?? null,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw failure(error);
      }
      if (!response.ok) {
        const said = await response.text().catch(() => "");
        throw failure(Object.assign(new Error(`The embeddings endpoint answered ${response.status} ${response.statusText}.${said ? ` ${said.slice(0, 500)}` : ""}`), { status: response.status }));
      }
      const answer = (await response.json()) as { data?: { index?: number; embedding?: unknown }[] };
      const rows = [...(answer.data ?? [])].sort((first, second) => (first.index ?? 0) - (second.index ?? 0));
      if (rows.length !== texts.length) throw new Error(`The embeddings endpoint gave ${rows.length} vectors for ${texts.length} texts.`);
      return rows.map((row) => {
        const vector = row.embedding;
        if (!Array.isArray(vector) || !vector.every((value) => typeof value === "number")) throw new Error("The embeddings endpoint gave something other than a list of numbers.");
        if (vector.length !== dimensions()) throw new Error(`The model gives vectors of ${vector.length} numbers, not the ${dimensions()} set${under}.`);
        return vector as number[];
      });
    },
    async embed_query(query, signal) {
      const [vector] = await client.embed([`${query_prefix()}${query}`], signal);
      return vector!;
    },
  };
  return client;
}
