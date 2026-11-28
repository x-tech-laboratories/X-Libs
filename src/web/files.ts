// Files a page reads from a file picker and hands the user to save, such as an export and its import.

// ── Files ────────────────────────────────────────────────────────────────────

// Hands the picked file's text on, then clears the picker so the same file can be picked again; null when none was picked.
export async function read_picked(event: { currentTarget: HTMLInputElement }): Promise<string | null> {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return null;
  const text = await file.text();
  input.value = "";
  return text;
}

// Offers the text as a download under the name given.
export function save_text(file_name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file_name;
  link.click();
  URL.revokeObjectURL(url);
}
