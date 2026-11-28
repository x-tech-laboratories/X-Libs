// Links to one email by its Message-ID, as RFC 2392 writes them: `mid:` links, which mail programs such as Thunderbird
// open to the message wherever it was filed.

// A Message-ID without the angle brackets a header carries it in.
export function bare_message_id(text: string): string {
  return text.trim().replace(/^<|>$/g, "");
}

// The `mid:` link that opens the email with this Message-ID.
export function email_uri(message_id: string): string {
  return `mid:${bare_message_id(message_id)}`;
}
