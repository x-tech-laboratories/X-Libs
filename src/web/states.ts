// What a request throws when the session has lapsed, so a page can tell it from any other failure and ask for a login.

export class LoginNeeded extends Error {}

// Hands a LoginNeeded on as an unhandled rejection, which the page's login listens for.
export function pass_login_needed(error: unknown): boolean {
  if (!(error instanceof LoginNeeded)) return false;
  void Promise.reject(error);
  return true;
}
