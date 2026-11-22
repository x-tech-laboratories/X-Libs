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
  // Marks a call that deletes or overwrites data, so an MCP client asks before running it.
  destructive?: boolean;
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

// ── Known ids ────────────────────────────────────────────────────────────────

// What exists now, as a set, a map by id, or a check.
export type KnownIds = ReadonlySet<string> | ReadonlyMap<string, unknown> | ((id: string) => boolean);

const is_known = (known: KnownIds, id: string): boolean => (typeof known === "function" ? known(id) : known.has(id));

// The ids that do not exist, each once, in the order given.
export function unknown_ids(ids: readonly string[], known: KnownIds): string[] {
  return [...new Set(ids)].filter((id) => !is_known(known, id));
}

// Refuses a call before it acts on anything when one of its ids does not exist, such as "no such track a1, b2".
export function check_known_ids(ids: readonly string[], known: KnownIds, noun: string): void {
  const unknown = unknown_ids(ids, known);
  if (unknown.length > 0) throw new Error(`no such ${noun} ${unknown.join(", ")}`);
}

// A remembered list of ids, such as picked columns, cut down to the ones that still exist, each once; anything not a list reads as empty.
export function keep_known_ids(value: unknown, known: KnownIds): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && is_known(known, id)))];
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

// What every call can answer.
const call_responses = {
  "200": { description: "the call's result as JSON" },
  "204": { description: "done, with nothing to return" },
  "400": { description: "the arguments were wrong, or the call refused them" },
  "401": { description: "not signed in" },
};

function openapi_envelope(options: Pick<OpenApiOptions, "title" | "version" | "description">, paths: JsonSchema): JsonSchema {
  return {
    openapi: "3.1.0",
    info: { title: options.title, version: options.version, ...(options.description ? { description: options.description } : {}) },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths,
  };
}

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
          responses: call_responses,
        },
      },
    ]),
  );
  return openapi_envelope(options, paths);
}

// A call served as a REST route, such as "GET /api/hosts/:name": each :name in the path takes the argument of that name,
// and the rest go in the query of a GET or DELETE and in the JSON body of anything else.
export interface RouteSpec extends MethodSpec {
  route: string;
}

// An OpenAPI 3.1 document of REST routes, each under its own path and verb; a GET only reads.
export function route_openapi_document(routes: Record<string, RouteSpec>, options: Pick<OpenApiOptions, "title" | "version" | "description">): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const [method, spec] of Object.entries(routes)) {
    const [verb, template] = spec.route.split(" ") as [string, string];
    const in_path = new Set([...template.matchAll(/:(\w+)/g)].map((match) => match[1]!));
    const rest = spec.params.filter((param) => !in_path.has(param.name));
    const in_query = verb === "GET" || verb === "DELETE";
    const parameters = [
      ...spec.params.filter((param) => in_path.has(param.name)).map((param) => ({ name: param.name, in: "path", required: true, schema: param.schema })),
      ...(in_query ? rest.map((param) => ({ name: param.name, in: "query", required: !param.optional, schema: param.schema })) : []),
    ];
    const body = !in_query && rest.length > 0
      ? { requestBody: { required: rest.some((param) => !param.optional), content: { "application/json": { schema: input_schema({ ...spec, params: rest }) } } } }
      : {};
    const path = template.replace(/:(\w+)/g, "{$1}");
    paths[path] ??= {};
    paths[path][verb.toLowerCase()] = {
      operationId: method,
      summary: spec.description,
      tags: [verb === "GET" ? "read" : "change"],
      ...(parameters.length > 0 ? { parameters } : {}),
      ...body,
      responses: call_responses,
    };
  }
  return openapi_envelope(options, paths);
}
