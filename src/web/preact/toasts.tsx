// Short notes in the page's corner after something happened, with an optional link or action such as Undo.

import { useEffect, useState } from "preact/hooks";

// ── Toasts ───────────────────────────────────────────────────────────────────

export interface ToastOptions {
  tone?: "good" | "bad" | "warn" | "info";
  link?: { href: string; text: string } | null;
  // A button that runs something and closes the toast, such as Undo.
  action?: { text: string; run: () => void };
  // An error stays until closed; anything else fades after a few seconds.
  sticky?: boolean;
  duration_in_milliseconds?: number;
}

interface Shown extends ToastOptions {
  id: number;
  message: string;
}

let shown: Shown[] = [];
let next_id = 1;
const listeners = new Set<(toasts: Shown[]) => void>();

function publish(toasts: Shown[]): void {
  shown = toasts;
  for (const listener of listeners) listener(shown);
}

// Shows the message and returns a function that closes it early.
export function toast(message: string, options: ToastOptions = {}): () => void {
  const id = next_id++;
  const close = () => publish(shown.filter((item) => item.id !== id));
  publish([...shown, { ...options, id, message }]);
  if (!(options.sticky ?? options.tone === "bad")) setTimeout(close, options.duration_in_milliseconds ?? 6000);
  return close;
}

// ── Host ─────────────────────────────────────────────────────────────────────

// Where toasts stack; the Shell holds one, and a page without the Shell renders its own.
export function Toasts() {
  const [toasts, set_toasts] = useState(shown);
  useEffect(() => {
    listeners.add(set_toasts);
    return () => void listeners.delete(set_toasts);
  }, []);

  return (
    <div id="toasts" class="toasts">
      {toasts.map((item) => {
        const tone = item.tone ?? "info";
        const close = () => publish(shown.filter((other) => other.id !== item.id));
        return (
          <div key={item.id} class={`toast tone-${tone}`} role={tone === "bad" ? "alert" : "status"}>
            <span>{item.message}</span>
            {item.link && <a href={item.link.href} onClick={close}>{item.link.text}</a>}
            {item.action && <button class="toast-action" onClick={() => { close(); item.action!.run(); }}>{item.action.text}</button>}
            <button class="icon" aria-label="Dismiss" onClick={close}>×</button>
          </div>
        );
      })}
    </div>
  );
}
