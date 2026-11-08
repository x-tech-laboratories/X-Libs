// Markdown written as text, with no page needed, so a server or a database upgrade can use it too.

// Three backticks, or one more than the longest run of them in the text, so the text can never close its own fence.
export function code_fence(text: string): string {
  const longest_run = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest_run + 1));
}

// Text as a fenced code block, shown exactly as written, Markdown signs and all.
export function as_code_block(text: string, language = ""): string {
  const fence = code_fence(text);
  return `${fence}${language}\n${text}\n${fence}`;
}
