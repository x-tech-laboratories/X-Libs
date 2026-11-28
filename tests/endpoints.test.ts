import { describe, expect, it } from "vitest";

import { ContextOverflow, PlainFailure, explain_endpoint_failure, hide_keys, host_of, is_local_endpoint, overflow_of, type EndpointWhere } from "../src/endpoints.ts";

// An address with a user and a word in it, made here so no such address is written out.
function with_user(endpoint: string, word: string): string {
  const url = new URL(endpoint);
  url.username = "someone";
  url.password = word;
  return url.href;
}

const engine: EndpointWhere = {
  endpoint: "http://127.0.0.1:8080/v1",
  model: "small-model",
  label: "engine",
  settings: "Settings → Engine",
  serves: "chat completions",
  retry: "send again",
  overflow_advice: "Raise the context size, or start a new conversation.",
};

const failure = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

describe("is_local_endpoint", () => {
  it("knows loopback and private-network hosts from hosted ones", () => {
    for (const endpoint of ["http://localhost:11434/v1", "http://ollama.localhost/v1", "http://127.0.0.1:8080", "http://10.0.0.2", "http://172.20.1.1", "http://192.168.1.20:8080/v1", "http://169.254.1.1", "http://[::1]:8080", "http://[fd12::1]", "http://[fe80::1]", "http://[::ffff:192.168.1.2]"]) {
      expect(is_local_endpoint(endpoint), endpoint).toBe(true);
    }
    for (const endpoint of ["https://api.openai.com/v1", "http://100.101.102.103:8080/v1", "http://172.32.0.1", "http://8.8.8.8", "http://[2606:4700::1]", "http://[::ffff:8.8.8.8]", "", "not a url", "http://999.1.1.1"]) {
      expect(is_local_endpoint(endpoint), endpoint).toBe(false);
    }
  });
});

describe("an endpoint's failures in plain words", () => {
  it("names a provider's own host when the endpoint is empty, and never a user or what follows it", () => {
    expect(host_of("", "https://api.openai.com/v1")).toBe("api.openai.com:443");
    expect(host_of(with_user("http://192.168.1.5:8080/v1", "word"), "")).toBe("192.168.1.5:8080");
    expect(host_of("ftp://files.example")).toBe("files.example");
    expect(host_of("not a url", "")).toBe("the address in its settings");
    expect(hide_keys("key sk-ant-api03-abcdefgh and more")).toBe("key [hidden] and more");
  });

  it("says what happened and what to do", () => {
    expect(explain_endpoint_failure(failure("Request timed out.", { name: "APIConnectionTimeoutError" }), { ...engine, endpoint: "", default_endpoint: "https://api.example.com" }).message).toBe(
      "The engine at api.example.com:443 did not answer in time. Check that its server is running and not overloaded, then send again.",
    );
    expect(explain_endpoint_failure(failure("fetch failed", { cause: { code: "ECONNREFUSED" } }), engine)).toEqual({
      message: "The engine at 127.0.0.1:8080 cannot be reached. Check that its server is running and that its endpoint under Settings → Engine is right.",
      detail: "fetch failed (ECONNREFUSED)",
    });
    expect(explain_endpoint_failure(failure(`401 Incorrect API key provided: sk-abcdef123456.`, { status: 401 }), engine)).toEqual({
      message: "The engine at 127.0.0.1:8080 refused the API key. Check its API key under Settings → Engine.",
      detail: "401 Incorrect API key provided: [hidden].",
    });
    expect(explain_endpoint_failure(failure("403", { status: 403 }), { ...engine, key_name: "API key command" }).message).toContain("Check its API key command under");
    expect(explain_endpoint_failure(failure("model 'small-model' not found", { status: 404 }), engine).message).toBe("The engine at 127.0.0.1:8080 does not know the model “small-model”. Check the model's name under Settings → Engine.");
    expect(explain_endpoint_failure(failure("404 Not Found", { status: 404 }), { endpoint: "http://localhost:1234" }).message).toBe("The service at localhost:1234 has no API at that address. Check its endpoint; it usually ends in /v1.");
    expect(explain_endpoint_failure(failure("Rate limit reached", { status: 429 }), engine).message).toBe("The engine at 127.0.0.1:8080 is limiting how often it is asked. Wait a minute and try again.");
    expect(explain_endpoint_failure(failure("Rate limit", { status: 429 }), { ...engine, rate_limit_advice: "Indexing tries again later." }).message).toMatch(/asked\. Indexing tries again later\.$/);
    expect(explain_endpoint_failure(failure("request (17931 tokens) exceeds the available context size", { status: 400 }), engine).message).toBe("The request was too large for the model's context. Raise the context size, or start a new conversation.");
    expect(explain_endpoint_failure(failure("Payload too large", { status: 413 }), { endpoint: "" }).message).toBe("The request was too large for the model's context.");
  });

  it("keeps anything else behind Details with a plain lead-in, or as it is when asked", () => {
    expect(explain_endpoint_failure(failure("CUDA out of memory", { status: 500 }), engine)).toEqual({ message: "The engine at 127.0.0.1:8080 could not answer.", detail: "CUDA out of memory" });
    expect(explain_endpoint_failure("odd", engine)).toEqual({ message: "The engine at 127.0.0.1:8080 could not answer.", detail: "odd" });
    expect(explain_endpoint_failure(failure("Set the model first."), { ...engine, keep_unknown: true })).toEqual({ message: "Set the model first." });
    expect(explain_endpoint_failure(failure("CUDA", { status: 500 }), { ...engine, keep_unknown: true }).message).toBe("The engine at 127.0.0.1:8080 could not answer.");
  });

  it("knows a size failure by its words or its status, with the tokens counted when said", () => {
    expect(overflow_of(failure("400 prompt is too long: 210000 tokens > 200000 maximum", { status: 400 }))).toMatchObject({ prompt_tokens: 210_000 });
    expect(overflow_of(failure("400 This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.", { status: 400 }))).toMatchObject({ prompt_tokens: 9000 });
    expect(overflow_of(failure("Payload too large", { status: 413 }))).toMatchObject({ prompt_tokens: null });
    expect(overflow_of(failure("400 bad tool schema", { status: 400 }))).toBeNull();
    const known = new ContextOverflow("x", 5);
    expect(overflow_of(known)).toBe(known);
    expect(new ContextOverflow("y").prompt_tokens).toBeNull();
    expect(new PlainFailure("Said plainly.", "raw")).toMatchObject({ name: "PlainFailure", message: "Said plainly.", detail: "raw" });
  });
});
