// The path a request names, read the way Fastify's router reads it, so a check on the path judges the route that answers.
// A request whose path can be read two ways is refused: an escaped letter, digit or "-._~", a "#", a target that does not
// start with "/", an empty segment, or a "." or ".." segment. Other escapes, such as "%20" or "%2F", are kept and read as
// the router decodes them.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyRequest } from "fastify";

// ── Shapes ───────────────────────────────────────────────────────────────────

// How the server's router reads a path, from the options Fastify was started with.
interface RouterReading {
  semicolon_ends_path: boolean;
  ignores_trailing_slash: boolean;
  ignores_duplicate_slashes: boolean;
  ignores_case: boolean;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const escaped_plain_character = /%(?:3[0-9]|[46][1-9a-f]|[57][0-9a]|2[de]|5f|7e)/i;
const dot_segment = /\/\.{1,2}(?:\/|$)/;
const absolute_form_origin = /^https?:\/\/[^/?#]*/i;

// ── Reading ──────────────────────────────────────────────────────────────────

function router_reading(request: FastifyRequest): RouterReading {
  const config = request.server.initialConfig as Record<string, unknown> & { routerOptions?: Record<string, unknown> };
  const router_options = config.routerOptions ?? {};
  const is_on = (name: string) => config[name] === true || router_options[name] === true;
  return {
    semicolon_ends_path: is_on("useSemicolonDelimiter"),
    ignores_trailing_slash: is_on("ignoreTrailingSlash"),
    ignores_duplicate_slashes: is_on("ignoreDuplicateSlashes"),
    ignores_case: config.caseSensitive === false || router_options.caseSensitive === false,
  };
}

// The target's path as sent, without an absolute form's origin, the query or a fragment.
function sent_path(url: string, semicolon_ends_path: boolean): string {
  const target = url.replace(absolute_form_origin, "");
  const end = target.search(semicolon_ends_path ? /[?#;]/ : /[?#]/);
  const path = end === -1 ? target : target.slice(0, end);
  return path.startsWith("/") ? path : `/${path}`;
}

// The path with its escapes decoded as the router decodes them, keeping escaped delimiters and "%25", or null when it cannot be decoded.
function decoded_path(path: string): string | null {
  try {
    return decodeURI(path.replaceAll("%25", "%2525"));
  } catch {
    return null;
  }
}

// The path the router matches the request against, as decisions about the request should read it.
export function path_of(request: FastifyRequest): string {
  const reading = router_reading(request);
  const sent = sent_path(request.url, reading.semicolon_ends_path);
  let path = decoded_path(sent) ?? sent;
  if (reading.ignores_duplicate_slashes) path = path.replaceAll(/\/\/+/g, "/");
  if (reading.ignores_trailing_slash && path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (reading.ignores_case) path = path.toLowerCase();
  return path;
}

// The pattern of the route that matched, such as "/api/hosts/:name", or null when none did.
export function route_of(request: FastifyRequest): string | null {
  if (request.is404) return null;
  return request.routeOptions.url ?? null;
}

// ── Checking ─────────────────────────────────────────────────────────────────

// Whether the path starts with the fixed beginning of the matched route's pattern.
function agrees_with_route(request: FastifyRequest, path: string): boolean {
  const route = route_of(request);
  if (route === null) return true;
  const reading = router_reading(request);
  let beginning = route.split(/[:*]/, 1)[0] ?? "";
  if (reading.ignores_duplicate_slashes) beginning = beginning.replaceAll(/\/\/+/g, "/");
  if (reading.ignores_case) beginning = beginning.toLowerCase();
  return path.startsWith(beginning) || (reading.ignores_trailing_slash && `${path}/`.startsWith(beginning));
}

// Whether the request's path reads only one way, so the path the guards check is the path the router matched.
export function is_plain_path(request: FastifyRequest): boolean {
  const url = request.url;
  if (!url.startsWith("/") || url.includes("#")) return false;
  const sent = sent_path(url, router_reading(request).semicolon_ends_path);
  if (escaped_plain_character.test(sent)) return false;
  const decoded = decoded_path(sent);
  if (decoded === null || decoded.includes("//") || dot_segment.test(decoded)) return false;
  return agrees_with_route(request, path_of(request));
}

// Whether the path, or the pattern of the route that matched, lies under the prefix.
export function is_under(request: FastifyRequest, path: string, prefix: string): boolean {
  const route = route_of(request);
  return path.startsWith(prefix) || (route !== null && route.startsWith(prefix));
}
