// Requests sent byte for byte over a socket, so a target reaches the server exactly as spelled.

// ── Imports ──────────────────────────────────────────────────────────────────

import { connect, type AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface RawAnswer {
  status: number;
  body: string;
}

// ── Sending ──────────────────────────────────────────────────────────────────

// Sends one request with the target as written and reads the status and body of the answer.
export async function send_raw(app: FastifyInstance, method: string, target: string, headers: Record<string, string> = {}): Promise<RawAnswer> {
  if (!app.server.listening) await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const header_lines = Object.entries({ host: "localhost", connection: "close", "content-length": "0", ...headers }).map(([name, value]) => `${name}: ${value}\r\n`).join("");
  const text = await new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(`${method} ${target} HTTP/1.1\r\n${header_lines}\r\n`));
    let received = "";
    socket.on("data", (chunk) => { received += chunk.toString(); });
    socket.on("end", () => resolve(received));
    socket.on("error", reject);
  });
  const [head = "", ...rest] = text.split("\r\n\r\n");
  return { status: Number(head.split(" ")[1]), body: rest.join("\r\n\r\n") };
}
