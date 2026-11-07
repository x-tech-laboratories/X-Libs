// Keyboard shortcuts for a page: "mod+z" style bindings that stay quiet while text is typed or a dialog or popover is open.

import { useEffect, useRef } from "react";

export interface Shortcut {
  // Keys joined by "+", such as "mod+z", "escape" or "ctrl+shift+a", where mod is Ctrl, or Cmd on Apple devices.
  keys: string;
  // Whether the shortcut also fires inside text fields; it does not by default.
  when?: "always" | "outside_fields";
  // Whether the shortcut also fires while a dialog or popover is open; it does not by default.
  over_overlays?: boolean;
  // Whether the browser's own action for the keys still happens; it is stopped by default.
  keep_default?: boolean;
  run: (event: KeyboardEvent) => void;
}

interface KeyCombination {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean | "any";
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const KEY_ALIASES: Record<string, string> = {
  esc: "escape", return: "enter", space: " ", spacebar: " ", del: "delete",
  up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright",
  plus: "+", cmd: "meta", command: "meta", control: "ctrl", option: "alt",
};

export function is_apple_platform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

// A punctuation key such as "?" needs Shift on some layouts and not others, so Shift is ignored unless named.
export function parse_keys(keys: string, apple = is_apple_platform()): KeyCombination {
  const parts = keys.toLowerCase().split(/\+(?!$)/).map((part) => KEY_ALIASES[part] ?? part);
  const key = parts.at(-1) ?? "";
  const modifiers = new Set(parts.slice(0, -1).map((part) => part === "mod" ? (apple ? "meta" : "ctrl") : part));
  const is_letter_or_named = /^[a-z0-9]$/.test(key) || key.length > 1;
  return {
    key,
    ctrl: modifiers.has("ctrl"),
    meta: modifiers.has("meta"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift") || (is_letter_or_named ? false : "any"),
  };
}

// Letters and digits also match by their physical key, so Alt+A still matches on a Mac where it types "å".
export function matches_keys(keys: string, event: KeyboardEvent, apple = is_apple_platform()): boolean {
  const combination = parse_keys(keys, apple);
  if (event.ctrlKey !== combination.ctrl || event.metaKey !== combination.meta || event.altKey !== combination.alt) return false;
  if (combination.shift !== "any" && event.shiftKey !== combination.shift) return false;
  if (event.key.toLowerCase() === combination.key) return true;
  return /^[a-z]$/.test(combination.key) ? event.code === `Key${combination.key.toUpperCase()}` : /^[0-9]$/.test(combination.key) && event.code === `Digit${combination.key}`;
}

// ── Help text ────────────────────────────────────────────────────────────────

const KEY_NAMES: Record<string, string> = {
  " ": "Space", escape: "Esc", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→",
  enter: "Enter", delete: "Delete", backspace: "Backspace", tab: "Tab", home: "Home", end: "End",
  pageup: "Page Up", pagedown: "Page Down",
};

// The keys as a person reads them: "Ctrl+Shift+Z" elsewhere, "⌘⇧Z" on Apple devices.
export function describe_keys(keys: string, apple = is_apple_platform()): string {
  const combination = parse_keys(keys, apple);
  const key = KEY_NAMES[combination.key] ?? (combination.key.length === 1 ? combination.key.toUpperCase() : capitalised(combination.key));
  const shift = combination.shift === true;
  if (apple) return [combination.ctrl && "⌃", combination.alt && "⌥", shift && "⇧", combination.meta && "⌘", key].filter(Boolean).join("");
  return [combination.ctrl && "Ctrl", combination.alt && "Alt", shift && "Shift", combination.meta && "Meta", key].filter(Boolean).join("+");
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── Guards ───────────────────────────────────────────────────────────────────

// Text fields, selects and editable regions keep their keys for typing.
export function is_typing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;
}

// An open dialog or popover takes the keyboard, so page shortcuts wait until it closes.
export function is_overlay_open(document: Document): boolean {
  return document.querySelector("dialog[open], [popover]:popover-open") !== null;
}

// Whether the shortcut should fire for the event, before its keys are compared.
export function is_shortcut_allowed(shortcut: Shortcut, event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  if ((shortcut.when ?? "outside_fields") === "outside_fields" && is_typing(event.target)) return false;
  return shortcut.over_overlays === true || !is_overlay_open(document);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

// Listens on the window while the component is shown; the first shortcut that matches runs, and the list may change on every render.
export function use_shortcuts(shortcuts: Shortcut[]): void {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    function on_key(event: KeyboardEvent): void {
      if (event.defaultPrevented) return;
      const shortcut = latest.current.find((each) => matches_keys(each.keys, event) && is_shortcut_allowed(each, event));
      if (!shortcut) return;
      if (!shortcut.keep_default) event.preventDefault();
      shortcut.run(event);
    }

    window.addEventListener("keydown", on_key);
    return () => window.removeEventListener("keydown", on_key);
  }, []);
}
