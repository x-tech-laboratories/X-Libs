// Short one-line excerpts of longer text, such as an item's body shown under its title.

// The text on one line, its runs of whitespace made single spaces, and cut with an ellipsis to at most `length`
// characters.
export function shorten(text: string, length = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, Math.max(length - 1, 0))}…` : flat;
}
