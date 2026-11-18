import { describe, expect, it } from "vitest";
import { check_known_ids, input_schema, keep_known_ids, openapi_document, positional_args, unknown_ids, type MethodSpec } from "../src/api_spec.ts";

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
