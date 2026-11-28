// Who is making the call in hand: the user at the app's own page (a signed-in browser or the desktop window), the
// app's own assistant or background work acting on its own, or another program through a token or MCP. It is set
// around each call's synchronous part, which is where a store reads it.

// ── Caller ───────────────────────────────────────────────────────────────────

export type Caller = "page" | "program" | "engine";

let current: Caller = "page";

// Runs the work as the caller given; the caller before comes back once its synchronous part ends.
export function as_caller<Result>(caller: Caller, work: () => Result): Result {
  const before = current;
  current = caller;
  try {
    return work();
  } finally {
    current = before;
  }
}

export function current_caller(): Caller {
  return current;
}

// The caller a server request is: a token is a program, a browser signed in itself or through a proxy is the user.
export function caller_of(request: object): Caller {
  const viewer = (request as { viewer?: { via: string } | null }).viewer;
  return viewer?.via === "token" ? "program" : "page";
}
