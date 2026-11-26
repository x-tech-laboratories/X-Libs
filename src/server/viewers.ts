// Who a request came from, as `server/account_sign_in` tells them apart, in a module of its own so a route such as
// `server/sync_routes` can ask without loading the sign-in.

// ── Kinds ────────────────────────────────────────────────────────────────────

// What made a token: the device sign-in that sets up sync, or the account page or the config for a program.
export type TokenKind = "device" | "program";

// Whether a request's viewer is the user themself, at the page or on one of their own devices, rather than a program:
// a session, the trusted proxy, or a token the device sign-in made. Nobody signed in, or a token from the config, is not.
export function is_user_or_device(viewer: { via: string; token_kind?: TokenKind } | null | undefined): boolean {
  if (viewer === null || viewer === undefined) return false;
  return viewer.via === "token" ? viewer.token_kind === "device" : true;
}
