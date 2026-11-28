// Text anyone could have written, such as an item's title from another app or a page fetched from the web, fenced so a
// model reads it as data and never as orders.

// ── Fence ────────────────────────────────────────────────────────────────────

export const untrusted_open = "<untrusted-data>";
export const untrusted_close = "</untrusted-data>";
export const redacted_instruction = "[instruction removed]";

const fence_tag = /<\s*\/?\s*untrusted-data\s*>/gi;

// Sentences that give orders to whoever reads them; a small model obeys these even inside a fence.
const injection_patterns = new RegExp(
  [
    String.raw`\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(instructions?|prompts?|rules|directions)\b`,
    String.raw`\b(note|message|instructions?)\s+(to|for)\s+(ai|llms?|language models?|assistants?|chatbots?|the model)\b`,
    String.raw`\bsystem prompt\b`,
    String.raw`\b(end|start|begin|finish)\s+(every|each|all|your)\s+(answers?|replies|responses|messages)\b`,
    String.raw`^\s*(system|assistant|developer)\s*:`,
  ].join("|"),
  "im",
);
const sentence = /(\s*)([^.!?\n]*[.!?]*)/g;

// Blanks out every sentence that tells the reader what to do, keeping the facts around it.
export function remove_instructions(text: string): string {
  return text.replace(sentence, (whole: string, space: string, said: string) => (injection_patterns.test(said) ? space + redacted_instruction : whole));
}

// The text inside a fence, with fence tags and orders taken out so it cannot close the fence or take over.
export function untrusted_block(text: string): string {
  return `${untrusted_open}\n${remove_instructions(text.replace(fence_tag, "[tag removed]"))}\n${untrusted_close}`;
}
