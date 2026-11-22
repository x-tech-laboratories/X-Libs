// The headers that keep a browser from misusing an app's pages: a content security policy that loads scripts only from
// the app itself, no framing by other sites, no guessing of content types, and no full addresses sent to other sites.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";

// ── Shapes ───────────────────────────────────────────────────────────────────

// Each directive with its sources, such as { "img-src": ["'self'", "https://images.example"] }.
export type ContentSecurityPolicy = Record<string, string[]>;

export interface SecurityHeadersOptions {
  // Directives replacing the default's of the same name; null leaves the header off.
  content_security_policy?: ContentSecurityPolicy | null;
  // Whether the app's own pages may frame it; no page may unless set.
  allow_same_origin_frames?: boolean;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// What a built page needs: its own scripts, styles set from code, and images and fonts Vite inlined as data.
export const default_content_security_policy: ContentSecurityPolicy = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

// ── Headers ──────────────────────────────────────────────────────────────────

// The header text of a policy.
export function policy_text(policy: ContentSecurityPolicy): string {
  return Object.entries(policy).map(([directive, sources]) => [directive, ...sources].join(" ")).join("; ");
}

// The headers every answer carries.
export function security_headers(options: SecurityHeadersOptions = {}): Record<string, string> {
  const frames = options.allow_same_origin_frames ? "'self'" : "'none'";
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": options.allow_same_origin_frames ? "SAMEORIGIN" : "DENY",
    "referrer-policy": "same-origin",
    "cross-origin-opener-policy": "same-origin",
  };
  if (options.content_security_policy !== null) {
    const policy = { ...default_content_security_policy, "frame-ancestors": [frames], ...options.content_security_policy };
    headers["content-security-policy"] = policy_text(policy);
  }
  return headers;
}

// ── Registration ─────────────────────────────────────────────────────────────

// Adds the headers to every answer that does not set them itself.
export function register_security_headers(app: FastifyInstance, options: SecurityHeadersOptions = {}): void {
  const headers = Object.entries(security_headers(options));
  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of headers) if (!reply.hasHeader(name)) void reply.header(name, value);
    return payload;
  });
}
