// Short notes in the page's corner after something happened, with an optional link or action such as Undo.

import { useEffect, useState } from "react";

// ── Toasts ───────────────────────────────────────────────────────────────────

export interface ToastOptions {
  tone?: "good" | "bad" | "warn" | "info";
  link?: { href: string; text: string } | null;
  // A button that runs something and closes the toast, such as Undo.
  action?: { text: string; run: () => void };
  // An error stays until closed; anything else fades after a few seconds.
  sticky?: boolean;
  duration_in_milliseconds?: number;
  // Called once it closes, saying why, such as to delete for good what an Undo toast kept.
  on_close?: (reason: ToastCloseReason) => void;
}

export type ToastCloseReason = "timeout" | "dismissed" | "action" | "closed";

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

// Takes the toast away and tells its owner why, once only.
function close_toast(id: number, reason: ToastCloseReason): void {
  const item = shown.find((each) => each.id === id);
  if (!item) return;
  publish(shown.filter((each) => each.id !== id));
  item.on_close?.(reason);
}

// Shows the message and returns a function that closes it early.
export function toast(message: string, options: ToastOptions = {}): () => void {
  const id = next_id++;
  publish([...shown, { ...options, id, message }]);
  if (!(options.sticky ?? options.tone === "bad")) setTimeout(() => close_toast(id, "timeout"), options.duration_in_milliseconds ?? 6000);
  return () => close_toast(id, "closed");
}

// ── Undo ─────────────────────────────────────────────────────────────────────

export interface UndoableOptions {
  // Carries the action out for good, once the toast closes any way but Undo, or when finished early.
  commit: () => void;
  // Takes the action back when Undo is pressed.
  undo: () => void;
  duration_in_milliseconds?: number;
  undo_label?: string;
}

export interface Undoable {
  // Commits now and closes the toast, such as before a newer action or when the page closes; does nothing once settled.
  finish: () => void;
  // Undoes now and closes the toast, such as for Ctrl+Z; does nothing once settled.
  undo: () => void;
  readonly settled: boolean;
}

// Shows the message with an Undo button, then either undoes or commits the action, exactly once.
export function undoable(message: string, { commit, undo, duration_in_milliseconds = 8000, undo_label = "Undo" }: UndoableOptions): Undoable {
  let settled = false;
  let undo_wanted = false;

  const settle = (reason: ToastCloseReason) => {
    if (settled) return;
    settled = true;
    if (reason === "action" || undo_wanted) undo();
    else commit();
  };

  const close = toast(message, {
    action: { text: undo_label, run: () => {} },
    duration_in_milliseconds,
    on_close: settle,
  });

  return {
    finish: () => close(),
    undo: () => {
      if (settled) return;
      undo_wanted = true;
      close();
    },
    get settled() {
      return settled;
    },
  };
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
    <div id="toasts" className="toasts">
      {toasts.map((item) => {
        const tone = item.tone ?? "info";
        const close = () => close_toast(item.id, "dismissed");
        return (
          <div key={item.id} className={`toast tone-${tone}`} role={tone === "bad" ? "alert" : "status"}>
            <span>{item.message}</span>
            {item.link && <a href={item.link.href} onClick={close}>{item.link.text}</a>}
            {item.action && <button className="toast-action" onClick={() => { close_toast(item.id, "action"); item.action!.run(); }}>{item.action.text}</button>}
            <button className="icon remove" aria-label="Dismiss" onClick={close}>×</button>
          </div>
        );
      })}
    </div>
  );
}
