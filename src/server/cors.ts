// Cross-origin access for an API that a native or mobile shell calls from a page of its own: any origin may, since a
// browser sends no cookies with such a call and the server's secret is still needed.

import fastify_cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

import { default_client_id_header } from "./events.ts";

export interface OpenCorsOptions {
  // The methods allowed; GET and POST unless set.
  methods?: string[];
  // Headers a page may send beyond authorization, content-type and the client id header.
  allowed_headers?: string[];
  // The header a page names its event stream client in.
  client_id_header?: string;
  // How long a browser keeps a preflight answer; a day unless set.
  max_age_seconds?: number;
}

export async function register_open_cors(app: FastifyInstance, options: OpenCorsOptions = {}): Promise<void> {
  const { methods = ["GET", "POST"], allowed_headers = [], client_id_header = default_client_id_header, max_age_seconds = 86_400 } = options;
  await app.register(fastify_cors, {
    origin: "*",
    methods,
    allowedHeaders: ["authorization", "content-type", client_id_header, ...allowed_headers],
    maxAge: max_age_seconds,
  });
}
