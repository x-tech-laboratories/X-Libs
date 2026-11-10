import { describe, expect, it } from "vitest";
import { input_schema, openapi_document, positional_args, type MethodSpec } from "../src/api_spec.ts";

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
