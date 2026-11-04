// Menus and popovers opened at a point: kept on screen, and closed by Escape, a click elsewhere, scrolling or leaving the window.

import { h, type Child } from "./dom.ts";

// ── Items ────────────────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  run: () => void;
  // A right-aligned hint, such as a keyboard shortcut.
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  separator_before?: boolean;
  // Set on an item that is ticked on or off, and shows whether it is ticked now.
  checked?: boolean;
}

export function menu_item_class(item: MenuItem): string {
  return item.danger ? "menu-item danger" : "menu-item";
}

export function menu_item_role(item: MenuItem): "menuitem" | "menuitemcheckbox" {
  return item.checked === undefined ? "menuitem" : "menuitemcheckbox";
}

// ── Placing ──────────────────────────────────────────────────────────────────

const edge_gap = 4;

// Where an element opened at a point goes so it stays on screen: flipped to the point's other side, or pushed back from the edge.
export function on_screen_position(x: number, y: number, width: number, height: number, room_width = window.innerWidth, room_height = window.innerHeight): { left: number; top: number } {
  const place = (start: number, size: number, room: number): number => {
    if (start + size + edge_gap <= room) return start;
    if (start - size >= edge_gap) return start - size;
    return Math.max(edge_gap, room - size - edge_gap);
  };
  return { left: place(x, width, room_width), top: place(y, height, room_height) };
}

export function place_on_screen(element: HTMLElement, x: number, y: number): void {
  const size = element.getBoundingClientRect();
  const position = on_screen_position(x, y, size.width, size.height);
  element.style.left = `${position.left}px`;
  element.style.top = `${position.top}px`;
}

// ── Dismissing ───────────────────────────────────────────────────────────────

// Calls close on Escape, a press or right-click outside the element, scrolling outside it, or the window losing focus; returns a function that stops listening.
export function dismiss_on_outside(element: HTMLElement, close: () => void): () => void {
  const outside = (event: Event) => {
    if (!element.contains(event.target as Node)) close();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  // Listening at once would catch the very click that opened the element, which would close it straight away.
  const attach = setTimeout(() => {
    document.addEventListener("pointerdown", outside);
    document.addEventListener("contextmenu", outside);
  }, 0);
  window.addEventListener("keydown", escape);
  window.addEventListener("blur", close);
  window.addEventListener("scroll", outside, true);
  return () => {
    clearTimeout(attach);
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("contextmenu", outside);
    window.removeEventListener("keydown", escape);
    window.removeEventListener("blur", close);
    window.removeEventListener("scroll", outside, true);
  };
}

// ── Opening ──────────────────────────────────────────────────────────────────

// Puts the element on the page at the point and wires its closing; returns the function that closes it.
function open_at(element: HTMLElement, x: number, y: number, on_close?: () => void): () => void {
  let stop = () => {};
  const close = () => {
    stop();
    element.remove();
    on_close?.();
  };
  document.body.append(element);
  place_on_screen(element, x, y);
  stop = dismiss_on_outside(element, close);
  return close;
}

// A right-click menu at the point, such as a mouse event's clientX and clientY.
export function open_context_menu(x: number, y: number, items: MenuItem[], on_close?: () => void): () => void {
  const menu = h("div", { class: "menu", role: "menu", tabindex: -1 });
  const close = open_at(menu, x, y, on_close);
  menu.append(...items.flatMap((item) => [
    item.separator_before ? h("div", { class: "menu-separator", role: "separator" }) : null,
    h("button", {
      type: "button", class: menu_item_class(item), role: menu_item_role(item),
      "aria-checked": item.checked === undefined ? null : String(item.checked), disabled: item.disabled ?? false,
      onclick: () => {
        close();
        item.run();
      },
    }, h("span", { class: "menu-label" }, item.label), item.hint && h("span", { class: "menu-hint" }, item.hint)),
  ].filter((node) => node !== null)));
  place_on_screen(menu, x, y);
  menu.querySelector<HTMLElement>(".menu-item:not(:disabled)")?.focus();
  return close;
}

// A popover holding any content, such as a column's filter, with its first field ready to type into.
export function open_popover(x: number, y: number, content: Child, label: string, on_close?: () => void): () => void {
  const popover = h("div", { class: "popover", role: "dialog", "aria-label": label }, content);
  const close = open_at(popover, x, y, on_close);
  popover.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  return close;
}
