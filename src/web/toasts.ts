// Short notes in the page's corner after something happened, with an optional link or action such as Undo.

import { h } from "./dom.ts";

// ── Toasts ───────────────────────────────────────────────────────────────────

export interface ToastOptions {
  tone?: "good" | "bad" | "warn" | "info";
  link?: { href: string; text: string };
  // A button that runs something and closes the toast, such as Undo.
  action?: { text: string; run: () => void };
  // An error stays until closed; anything else fades after a few seconds.
  sticky?: boolean;
  duration_in_milliseconds?: number;
}

// The region toasts stack in, made at the foot of the page when the page has none of its own.
function region(): HTMLElement {
  const existing = document.querySelector<HTMLElement>("#toasts");
  if (existing) return existing;
  const made = h("div", { id: "toasts", class: "toasts" });
  document.body.append(made);
  return made;
}

// Shows the message and returns a function that closes it early.
export function toast(message: string, options: ToastOptions = {}): () => void {
  const tone = options.tone ?? "info";
  const close = () => item.remove();
  const action = options.action;
  const item = h("div", { class: `toast tone-${tone}`, role: tone === "bad" ? "alert" : "status" },
    h("span", {}, message),
    options.link && h("a", { href: options.link.href, onclick: close }, options.link.text),
    action && h("button", { class: "toast-action", onclick: () => { close(); action.run(); } }, action.text),
    h("button", { class: "icon", "aria-label": "Dismiss", onclick: close }, "×"));
  region().append(item);
  if (!(options.sticky ?? tone === "bad")) setTimeout(close, options.duration_in_milliseconds ?? 6000);
  return close;
}
