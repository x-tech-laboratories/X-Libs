// What a local search index does to text: a hash to see whether it changed, pieces cut for embedding, vectors as
// stored blobs and their dot product, the search words as an SQLite FTS5 query, and rankings fused into one.

// ── Hash ─────────────────────────────────────────────────────────────────────

// A 53-bit hash of the text (cyrb53) as hex, to tell changed text from unchanged; not for security.
export function text_hash(text: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(16);
}

// ── Chunks ───────────────────────────────────────────────────────────────────

export const chunk_chars = 1200;
export const overlap_chars = 200;

// The text in pieces of at most chunk_chars, each starting overlap_chars before the last ended, cut at a space where
// one is near, so a long text is embedded whole and a sentence across a cut is in both pieces.
export function chunk_text(text: string, size = chunk_chars, overlap = overlap_chars): string[] {
  const flat = text.trim();
  if (flat.length <= size) return flat ? [flat] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < flat.length) {
    let end = Math.min(flat.length, start + size);
    if (end < flat.length) {
      const space = flat.lastIndexOf(" ", end);
      if (space > start + size / 2) end = space;
    }
    chunks.push(flat.slice(start, end).trim());
    if (end >= flat.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

// ── Vectors ──────────────────────────────────────────────────────────────────

// A vector scaled to length one, so the cosine of two is their dot product.
export function unit(vector: number[]): Float32Array {
  const length = Math.hypot(...vector) || 1;
  return Float32Array.from(vector, (value) => value / length);
}

export function to_blob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

export function from_blob(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

export function dot(first: Float32Array, second: Float32Array): number {
  let sum = 0;
  for (let at = 0; at < Math.min(first.length, second.length); at++) sum += first[at]! * second[at]!;
  return sum;
}

// ── Queries ──────────────────────────────────────────────────────────────────

// The words typed as an FTS5 query, each a quoted prefix so no word is read as an operator; joined by AND, or OR.
export function fts_query(text: string, joiner: "AND" | "OR" = "AND"): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((word) => `"${word}"*`).join(` ${joiner} `);
}

// Reciprocal rank fusion: each list adds 1 / (k + rank) for every key it ranks, best first.
export function fuse_ranks(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((key, index) => scores.set(key, (scores.get(key) ?? 0) + 1 / (k + index + 1)));
  return scores;
}
