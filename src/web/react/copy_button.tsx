// Copying text to the clipboard with a "Copied." toast: `CopyButton` copies what it is given, or what a function gives
// back when pressed, such as a secret fetched only then, and `copy_text` does the same from anywhere; a page the browser
// will not let copy says so instead of failing quietly.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useState } from "react";

import { describe_error } from "../errors.ts";
import { toast } from "./toasts.tsx";

// ── Copying ──────────────────────────────────────────────────────────────────

// Copies the text and says so in a toast; false when the clipboard refused it or getting the text failed.
export async function copy_text(text: string | (() => string | Promise<string>), copied_text = "Copied."): Promise<boolean> {
  let value: string;
  try {
    value = typeof text === "function" ? await text() : text;
  } catch (error) {
    toast(describe_error(error), { tone: "bad" });
    return false;
  }
  try {
    if (!navigator.clipboard) throw new Error("no clipboard");
    await navigator.clipboard.writeText(value);
  } catch {
    toast("Could not copy; select the text and copy it by hand.", { tone: "bad" });
    return false;
  }
  toast(copied_text);
  return true;
}

// ── Button ───────────────────────────────────────────────────────────────────

interface CopyButtonProps {
  // The text, or a function giving it back when the button is pressed.
  text: string | (() => string | Promise<string>);
  label?: string;
  copied_text?: string;
  class_name?: string;
  // What the button copies, for screen readers and a tooltip, such as "Copy the payload URL".
  title?: string;
  disabled?: boolean;
}

export function CopyButton({ text, label = "Copy", copied_text = "Copied.", class_name, title, disabled = false }: CopyButtonProps) {
  const [busy, set_busy] = useState(false);
  async function copy(): Promise<void> {
    set_busy(true);
    try {
      await copy_text(text, copied_text);
    } finally {
      set_busy(false);
    }
  }
  return (
    <button type="button" className={class_name} title={title} aria-label={title} disabled={disabled || busy} onClick={() => void copy()}>
      {label}
    </button>
  );
}
