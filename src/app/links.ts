// Links such as x-notes://note/<id>, which open the desktop app on that page from a notification or any other program,
// in the scheme the app names.

// ── Links ────────────────────────────────────────────────────────────────────

// The link to a page, given its route such as "#/note/<id>".
export function app_link(scheme: string, route: string): string {
  return `${scheme}://${route.replace(/^#?\/?/, "")}`;
}

// The page's route a link names, such as "#/note/<id>", or null when the text is not one of the app's links.
export function route_of_link(scheme: string, text: string): string | null {
  const prefix = `${scheme.toLowerCase()}://`;
  if (!text.toLowerCase().startsWith(prefix)) return null;
  const path = text.slice(prefix.length).replace(/\/+$/, "");
  return /^[a-z0-9/_-]*$/i.test(path) ? `#/${path}` : null;
}
