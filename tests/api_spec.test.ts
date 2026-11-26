import { describe, expect, it } from "vitest";
import {
  check_known_ids, default_page_only_refusal, input_schema, keep_known_ids, openapi_document, page_only_calls, positional_args, route_openapi_document, unknown_ids, type MethodSpec,
} from "../src/api_spec.ts";

const add_set: MethodSpec = {
  description: "Adds a set to an exercise.",
  params: [
    { name: "exercise_id", schema: { type: "string" } },
    { name: "weight", schema: { type: "number" } },
    { name: "reps", schema: { type: "integer" }, optional: true },
  ],
};

describe("api specs", () => {
  it("takes the arguments as one object, requiring all but the optional ones", () => {
    expect(input_schema(add_set)).toEqual({
      type: "object",
      properties: { exercise_id: { type: "string" }, weight: { type: "number" }, reps: { type: "integer" } },
      required: ["exercise_id", "weight"],
      additionalProperties: false,
    });
  });

  it("puts named arguments in the method's order and leaves missing optional ones to the method", () => {
    expect(positional_args(add_set, { weight: 100, exercise_id: "squat", reps: 5 })).toEqual(["squat", 100, 5]);
    expect(positional_args(add_set, { weight: 100, exercise_id: "squat" })).toEqual(["squat", 100]);
  });

  it("refuses unknown and missing arguments by name", () => {
    expect(() => positional_args(add_set, { exercise_id: "squat", weight: 100, sets: 3 })).toThrow("unknown argument sets");
    expect(() => positional_args(add_set, { exercise_id: "squat" })).toThrow("missing argument weight");
  });

  it("describes every call as a POST in an OpenAPI document", () => {
    const document = openapi_document(
      { add_set, list_sets: { description: "Lists the sets.", params: [] } },
      { title: "Lifts", version: "1.0.0", path_of: (method) => `/api/call/${method}`, is_read_only: (method) => method.startsWith("list_") },
    );

    const paths = document.paths as Record<string, { post: { operationId: string; tags: string[]; requestBody: { required: boolean } } }>;
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(paths)).toEqual(["/api/call/add_set", "/api/call/list_sets"]);
    expect(paths["/api/call/add_set"]!.post).toMatchObject({ operationId: "add_set", tags: ["change"], requestBody: { required: true } });
    expect(paths["/api/call/list_sets"]!.post).toMatchObject({ tags: ["read"], requestBody: { required: false } });
  });

  it("describes REST routes under their own paths and verbs, with path, query and body arguments", () => {
    const name = { name: "name", schema: { type: "string" } };
    const document = route_openapi_document(
      {
        get_host: { route: "GET /api/hosts/:name", description: "Shows a host.", params: [name, { name: "since", schema: { type: "integer" }, optional: true }] },
        set_next_boot: {
          route: "POST /api/hosts/:name/next-boot",
          description: "Sets the next boot.",
          params: [name, { name: "entry", schema: { type: "string" } }, { name: "reboot", schema: { type: "boolean" }, optional: true }],
        },
        refresh_host: { route: "POST /api/hosts/:name", description: "Reads a host again.", params: [name] },
        list_hosts: { route: "GET /api/hosts", description: "Lists the hosts.", params: [] },
      },
      { title: "Hosts", version: "1.0.0" },
    );

    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(document).toMatchObject({ openapi: "3.1.0", info: { title: "Hosts", version: "1.0.0" }, security: [{ bearer: [] }] });
    expect(Object.keys(paths)).toEqual(["/api/hosts/{name}", "/api/hosts/{name}/next-boot", "/api/hosts"]);
    expect(paths["/api/hosts/{name}"]!.get).toMatchObject({
      operationId: "get_host",
      tags: ["read"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
        { name: "since", in: "query", required: false, schema: { type: "integer" } },
      ],
    });
    expect(paths["/api/hosts/{name}"]!.get).not.toHaveProperty("requestBody");
    expect(paths["/api/hosts/{name}"]!.post).toMatchObject({ operationId: "refresh_host", tags: ["change"] });
    expect(paths["/api/hosts/{name}"]!.post).not.toHaveProperty("requestBody");
    expect(paths["/api/hosts/{name}/next-boot"]!.post).toMatchObject({
      parameters: [{ name: "name", in: "path" }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { properties: { entry: { type: "string" }, reboot: { type: "boolean" } }, required: ["entry"] } } },
      },
    });
    expect(paths["/api/hosts"]!.get).not.toHaveProperty("parameters");
  });
});

describe("known ids", () => {
  const tracks = new Set(["a1", "b2", "c3"]);

  it("names the ids that do not exist, each once, in the order given", () => {
    expect(unknown_ids(["x9", "a1", "y8", "x9"], tracks)).toEqual(["x9", "y8"]);
    expect(unknown_ids(["a1", "c3"], new Map([["a1", 1], ["c3", 3]]))).toEqual([]);
    expect(unknown_ids(["a1", "zz"], (id) => id.length === 2 && id !== "zz")).toEqual(["zz"]);
  });

  it("refuses a call naming an id that does not exist, before it acts", () => {
    expect(() => check_known_ids(["a1", "b2"], tracks, "track")).not.toThrow();
    expect(() => check_known_ids(["a1", "gone", "lost"], tracks, "track")).toThrow("no such track gone, lost");
  });

  it("cuts a remembered list down to the ids that still exist", () => {
    expect(keep_known_ids(["c3", "deleted", "a1", "c3", 7, null], tracks)).toEqual(["c3", "a1"]);
    for (const wrong_shape of [null, "a1", 42, { a1: true }]) expect(keep_known_ids(wrong_shape, tracks)).toEqual([]);
  });
});

describe("page-only calls", () => {
  const api: Record<string, MethodSpec> = {
    approve: { description: "Approves a proposal.", params: [{ name: "id", schema: { type: "string" } }], page_only: true },
    set_setting: { description: "Sets a setting.", params: [{ name: "key", schema: { type: "string" } }, { name: "value", schema: {} }] },
    list_settings: { description: "Lists the settings.", params: [] },
  };
  const rule = (method: string, args: readonly unknown[]) => method === "set_setting" && args[0] === "policy";

  it("are the marked calls, and the uses the app's rule names", () => {
    const page_only = page_only_calls(api, { rule, refusal: "Only at the page." });

    expect(page_only.is_page_only("approve")).toBe(true);
    expect(page_only.is_page_only("set_setting")).toBe(false);
    expect(page_only.is_page_only("toString")).toBe(false);
    expect(page_only.is_page_only_call("set_setting", ["policy", 1])).toBe(true);
    expect(page_only.is_page_only_call("set_setting", ["theme", "dark"])).toBe(false);
    expect(page_only.refusal).toBe("Only at the page.");
  });

  it("read a request's arguments as a list or by name, leaving wrong names to the call, and count any other body as the user's when there is a rule", () => {
    const page_only = page_only_calls(api, { rule });

    expect(page_only.is_page_only_request("set_setting", ["policy", 1])).toBe(true);
    expect(page_only.is_page_only_request("set_setting", { value: 1, key: "policy" })).toBe(true);
    expect(page_only.is_page_only_request("set_setting", { key: "theme", value: "dark" })).toBe(false);
    expect(page_only.is_page_only_request("set_setting", { key: "policy", extra: 1 })).toBe(true);
    expect(page_only.is_page_only_request("set_setting", { key: "theme" })).toBe(false);
    expect(page_only.is_page_only_request("list_settings", { not: "an argument" })).toBe(false);
    expect(page_only.is_page_only_request("no_such_call", { key: "policy" })).toBe(false);
    expect(page_only.is_page_only_request("set_setting", "policy")).toBe(true);
    expect(page_only.is_page_only_request("approve", { id: "p1" })).toBe(true);
    expect(page_only.is_page_only_request("list_settings", undefined)).toBe(false);
    expect(page_only.refusal).toBe(default_page_only_refusal);
  });

  it("are only the marked calls without a rule, whatever the arguments", () => {
    const page_only = page_only_calls(api);

    expect(page_only.is_page_only_request("set_setting", { key: "policy", extra: 1 })).toBe(false);
    expect(page_only.is_page_only_request("set_setting", "policy")).toBe(false);
    expect(page_only.is_page_only_request("approve", null)).toBe(true);
  });

  it("are marked in the OpenAPI documents", () => {
    const document = openapi_document(api, { title: "Inbox", version: "1.0.0", path_of: (method) => `/api/call/${method}`, is_read_only: (method) => method.startsWith("list_") });
    const paths = document.paths as Record<string, { post: Record<string, unknown> & { responses: Record<string, unknown> } }>;
    expect(paths["/api/call/approve"]!.post).toMatchObject({ "x-page-only": true });
    expect(paths["/api/call/approve"]!.post.responses["403"]).toBeDefined();
    expect(paths["/api/call/set_setting"]!.post["x-page-only"]).toBeUndefined();

    const routes = route_openapi_document({ approve: { ...api.approve!, route: "POST /api/proposals/:id/approve" } }, { title: "Inbox", version: "1.0.0" });
    expect((routes.paths as Record<string, Record<string, Record<string, unknown>>>)["/api/proposals/{id}/approve"]!.post).toMatchObject({ "x-page-only": true });
  });
});
