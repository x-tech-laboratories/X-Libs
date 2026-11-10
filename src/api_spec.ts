// An app's calls described once, by name with plain words and a JSON Schema per argument, so other programs can use
// them: as MCP tools through server/mcp, as an OpenAPI document, and by named arguments in place of a list.

// ── Shapes ───────────────────────────────────────────────────────────────────

// A JSON Schema, as plain data.
export type JsonSchema = { [key: string]: unknown };

export interface ParamSpec {
  name: string;
  schema: JsonSchema;
  // Whether the call works without it; the arguments after it must be optional too.
  optional?: boolean;
}

export interface MethodSpec {
  // What the call does, in words a person or a model reads before using it.
  description: string;
  // The arguments in the order the method takes them.
  params: ParamSpec[];
}

// A spec for every method of a table, so a method added without one fails to compile.
export type ApiSpec<Methods> = { [Name in keyof Methods & string]: MethodSpec };

export interface OpenApiOptions {
  title: string;
  version: string;
  description?: string;
  // The URL path of one call, such as "/api/call/list_tasks".
  path_of: (method: string) => string;
  is_read_only: (method: string) => boolean;
}

// ── Arguments ────────────────────────────────────────────────────────────────

// The arguments as one JSON object, which is how MCP tools and named calls take them.
export function input_schema(spec: MethodSpec): JsonSchema {
  const properties = Object.fromEntries(spec.params.map((param) => [param.name, param.schema]));
  const required = spec.params.filter((param) => !param.optional).map((param) => param.name);
  return { type: "object", properties, required, additionalProperties: false };
}

// Named arguments put in the method's order, dropping missing ones at the end so the method's own defaults apply.
export function positional_args(spec: MethodSpec, named: Record<string, unknown>): unknown[] {
  const known = new Set(spec.params.map((param) => param.name));
  const unknown_names = Object.keys(named).filter((name) => !known.has(name));
  if (unknown_names.length > 0) throw new Error(`unknown argument ${unknown_names.join(", ")}`);
  const missing = spec.params.filter((param) => !param.optional && named[param.name] === undefined);
  if (missing.length > 0) throw new Error(`missing argument ${missing.map((param) => param.name).join(", ")}`);
  const args = spec.params.map((param) => named[param.name]);
  while (args.length > 0 && args.at(-1) === undefined) args.pop();
  return args;
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

// An OpenAPI 3.1 document with one POST per call, taking its arguments as a JSON object.
export function openapi_document(api: Record<string, MethodSpec>, options: OpenApiOptions): JsonSchema {
  const paths = Object.fromEntries(
    Object.entries(api).map(([method, spec]) => [
      options.path_of(method),
      {
        post: {
          operationId: method,
          summary: spec.description,
          tags: [options.is_read_only(method) ? "read" : "change"],
          requestBody: { required: spec.params.some((param) => !param.optional), content: { "application/json": { schema: input_schema(spec) } } },
          responses: {
            "200": { description: "the call's result as JSON" },
            "204": { description: "done, with nothing to return" },
            "400": { description: "the arguments were wrong, or the call refused them" },
            "401": { description: "not signed in" },
          },
        },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: { title: options.title, version: options.version, ...(options.description ? { description: options.description } : {}) },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths,
  };
}
