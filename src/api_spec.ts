// An app's calls described once, by name with plain words and a JSON Schema per argument, so other programs can use
// them: as MCP tools through server/mcp, as an OpenAPI document, and by named arguments in place of a list. A call
// marked page-only is the user's alone: only their own page makes it, and tokens and MCP clients are refused.

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
  // Marks a call only the user may make, at the app's own page (a signed-in browser, or a desktop window through its
  // daemon's socket), such as approving what an assistant proposed: tokens are refused it and MCP never offers it.
  page_only?: boolean;
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

// ── Page-only calls ──────────────────────────────────────────────────────────

// An app's own rule for uses of a call that are the user's alone, by its arguments in order, such as a write to a
// setting only the user may change.
export type PageOnlyRule = (method: string, args: readonly unknown[]) => boolean;

export const default_page_only_refusal = "Only you can do this, from the app's own page; a token or an MCP client cannot.";

// Which calls are the user's alone, as `server/account_sign_in`, `server/mcp` and `electron/mcp` ask.
export interface PageOnlyCalls {
  // Whether every use of the call is, as its spec marks it, so MCP leaves it out.
  is_page_only: (method: string) => boolean;
  // Whether this use is: a marked call, or one the app's rule names for these arguments.
  is_page_only_call: (method: string, args: readonly unknown[]) => boolean;
  // The same for arguments as a request sent them, a JSON list or an object by name; a body that is neither counts as
  // the user's alone when the app has a rule, since the rule cannot tell.
  is_page_only_request: (method: string, body: unknown) => boolean;
  // What a refused caller is told.
  refusal: string;
}

export interface PageOnlyOptions {
  rule?: PageOnlyRule;
  refusal?: string;
}

// The page-only calls of an api: those its specs mark, and the uses the app's rule names.
export function page_only_calls(api: Record<string, MethodSpec>, options: PageOnlyOptions = {}): PageOnlyCalls {
  const { rule } = options;
  const is_page_only = (method: string) => Object.hasOwn(api, method) && api[method]!.page_only === true;
  const is_page_only_call = (method: string, args: readonly unknown[]) => is_page_only(method) || (rule?.(method, args) ?? false);
  const is_page_only_request = (method: string, body: unknown) => {
    if (body === undefined || body === null) return is_page_only_call(method, []);
    if (Array.isArray(body)) return is_page_only_call(method, body);
    if (is_page_only(method)) return true;
    if (rule === undefined) return false;
    if (typeof body !== "object") return true;
    // Placed in order without checking them, so wrong or missing names are left for the call itself to refuse.
    const named = body as Record<string, unknown>;
    return rule(method, Object.hasOwn(api, method) ? api[method]!.params.map((param) => named[param.name]) : []);
  };
  return { is_page_only, is_page_only_call, is_page_only_request, refusal: options.refusal ?? default_page_only_refusal };
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

// What a page-only call adds: the `x-page-only` mark, a line saying so, and the refusal a token gets.
function page_only_marks(spec: MethodSpec): JsonSchema {
  if (spec.page_only !== true) return {};
  return {
    "x-page-only": true,
    description: "Only the user at the app's own page may make this call; a token is refused, and MCP does not offer it.",
  };
}

function responses_of(spec: MethodSpec): JsonSchema {
  return spec.page_only === true ? { ...call_responses, "403": { description: "only the user at the app's own page may make this call" } } : call_responses;
}

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
          ...page_only_marks(spec),
          requestBody: { required: spec.params.some((param) => !param.optional), content: { "application/json": { schema: input_schema(spec) } } },
          responses: responses_of(spec),
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
      ...page_only_marks(spec),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...body,
      responses: responses_of(spec),
    };
  }
  return openapi_envelope(options, paths);
}
