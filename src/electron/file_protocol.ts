// Synced files shown in a desktop app's page, such as covers, through a scheme of the app's own: `<scheme>://<name>`
// answers with the file's bytes from the store, so the page needs no network and no file paths.

import { is_file_name, type SyncFileStore } from "../sync_files.ts";

// ── Electron's shapes ────────────────────────────────────────────────────────

// Only the parts of Electron's protocol module these helpers use, so this module builds without Electron installed.
export interface ProtocolLike {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void;
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
}

// ── Scheme ───────────────────────────────────────────────────────────────────

// Call before the app is ready, as Electron asks, so the page may load images from the scheme.
export function register_file_scheme(protocol: ProtocolLike, scheme: string): void {
  protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

// The file's bytes for `<scheme>://<name>`; a file never changes, so the page may keep it for good. Call once the app is ready.
export function serve_files(protocol: ProtocolLike, scheme: string, store: SyncFileStore): void {
  protocol.handle(scheme, (request) => file_response(store, request.url));
}

export async function file_response(store: SyncFileStore, url: string): Promise<Response> {
  const name = new URL(url).hostname;
  const bytes = is_file_name(name) ? await store.read(name) : undefined;
  if (!bytes) return new Response("no such file", { status: 404 });
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "content-type": "application/octet-stream", "cache-control": "max-age=31536000, immutable" } });
}
