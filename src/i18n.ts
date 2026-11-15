// Words a page shows in the reader's language: catalogs of messages by key, the first catalog holding a key winning,
// with {name} placeholders filled in, and the locale that best fits what the reader's browser asks for.

export type Messages<Key extends string = string> = Partial<Record<Key, string>>;

export type Translate<Key extends string = string> = (key: Key, values?: Record<string, string | number>) => string;

// ── Translating ──────────────────────────────────────────────────────────────

// Looks a key up in each catalog in turn, so a translation missing a key falls back to the next, such as English; a key
// no catalog holds reads as itself.
export function create_translator<Key extends string>(...catalogs: (Messages<Key> | undefined)[]): Translate<Key> {
  return (key, values) => {
    const message = catalogs.find((catalog) => catalog?.[key] !== undefined)?.[key] ?? key;
    return values === undefined ? message : fill_placeholders(message, values);
  };
}

// Fills each {name} with its value, leaving a placeholder with no value as written.
export function fill_placeholders(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder));
}

// Every catalog merged into one, the earlier ones winning, such as a page's own words over the built-in ones.
export function merge_messages<Key extends string>(...catalogs: (Messages<Key> | undefined)[]): Messages<Key> {
  const merged: Messages<Key> = {};
  for (const catalog of catalogs.toReversed()) Object.assign(merged, catalog);
  return merged;
}

// ── Choosing a locale ────────────────────────────────────────────────────────

// The available locale that best fits the reader's preferred ones in order, an exact tag first and then the same
// language, such as "es" for "es-MX" or "pt-BR" for "pt"; the fallback when none fits.
export function best_locale(available: readonly string[], preferred: readonly string[], fallback: string): string {
  const lower = available.map((tag) => tag.toLowerCase());
  for (const wanted of preferred.map((tag) => tag.toLowerCase())) {
    const exact = lower.indexOf(wanted);
    if (exact !== -1) return available[exact];
    const language = language_of(wanted);
    const same_language = lower.findIndex((tag) => language_of(tag) === language);
    if (same_language !== -1) return available[same_language];
  }
  return fallback;
}

function language_of(tag: string): string {
  return tag.split("-")[0];
}

const right_to_left_languages = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "ks", "ps", "sd", "ug", "ur", "yi"]);

// Which way a language's text runs, for the page's dir attribute.
export function text_direction(tag: string): "ltr" | "rtl" {
  return right_to_left_languages.has(language_of(tag.toLowerCase())) ? "rtl" : "ltr";
}
