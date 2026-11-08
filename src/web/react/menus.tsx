// Menus and popovers on the native popover: closed by Escape or a click elsewhere, and here also by scrolling or leaving the window.

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { item_after_key, item_starting_with, on_screen_position, type MenuItem } from "../menus.ts";

export type { MenuItem } from "../menus.ts";

// ── Opening ──────────────────────────────────────────────────────────────────

interface PopoverHandle {
  element: RefObject<HTMLDivElement | null>;
  // Closes it and puts focus back where it was before it opened.
  dismiss: () => void;
  // Puts focus back where it was before it opened.
  return_focus: () => void;
}

// Shows the element as a popover while it is rendered, calling the latest on_close once it closes for any reason; a manual one closes itself on a press outside it.
function use_popover(on_close: () => void, opener?: HTMLElement | null, manual = false): PopoverHandle {
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(on_close);
  close.current = on_close;
  const focused_before = useRef<HTMLElement | null>(opener ?? (document.activeElement as HTMLElement | null));

  useEffect(() => {
    const popover = element.current!;
    const hide = () => { if (popover.matches(":popover-open")) popover.hidePopover(); };
    const toggled = (event: Event) => { if ((event as ToggleEvent).newState === "closed") close.current(); };
    const outside = (event: Event) => { if (!popover.contains(event.target as Node)) hide(); };
    popover.addEventListener("toggle", toggled);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", outside, true);
    if (manual) window.addEventListener("pointerdown", outside, true);
    return () => {
      popover.removeEventListener("toggle", toggled);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("pointerdown", outside, true);
    };
  }, []);

  const return_focus = () => {
    const before = focused_before.current;
    if (before?.isConnected && before !== document.body) before.focus();
  };
  const dismiss = () => {
    const popover = element.current;
    return_focus();
    if (popover?.matches(":popover-open")) popover.hidePopover();
    else close.current();
  };
  return { element, dismiss, return_focus };
}

// Shows the popover at the point, flipped or pushed back so it stays on screen.
function show_at(popover: HTMLElement, x: number, y: number): void {
  if (!popover.matches(":popover-open")) popover.showPopover();
  const size = popover.getBoundingClientRect();
  const position = on_screen_position(x, y, size.width, size.height);
  popover.style.left = `${position.left}px`;
  popover.style.top = `${position.top}px`;
}

// ── Keys ─────────────────────────────────────────────────────────────────────

const item_selector = '[role^="menuitem"]:not([aria-disabled="true"])';
const typeahead_pause_in_milliseconds = 600;

// Arrows, Home and End move between items, typing jumps to one by its first letters, Enter or Space runs it, and Escape closes.
function use_menu_keys(container: RefObject<HTMLElement | null>, dismiss: () => void, whole_menu: boolean): (event: KeyboardEvent<HTMLElement>) => void {
  const typed = useRef({ text: "", at: 0 });

  return (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (whole_menu && event.key === "Tab") return dismiss();

    const items = [...container.current!.querySelectorAll<HTMLElement>(item_selector)];
    const current = items.indexOf(document.activeElement as HTMLElement);
    // In a popover the keys belong to its fields until focus is on one of its items.
    if (!whole_menu && current < 0) return;

    if ((event.key === "Enter" || event.key === " ") && current >= 0) {
      event.preventDefault();
      items[current]!.click();
      return;
    }

    const moved = item_after_key(event.key, current, items.length);
    if (moved !== null) {
      event.preventDefault();
      items[moved]!.focus();
      return;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    const now = Date.now();
    typed.current = { text: now - typed.current.at > typeahead_pause_in_milliseconds ? event.key : typed.current.text + event.key, at: now };
    const labels = items.map((item) => item.querySelector(".menu-label")?.textContent ?? item.textContent ?? "");
    const found = item_starting_with(labels, typed.current.text, current);
    if (found !== null) {
      event.preventDefault();
      items[found]!.focus();
    }
  };
}

// ── Items ────────────────────────────────────────────────────────────────────

interface MenuListProps {
  items: MenuItem[];
  // Called before an item runs, unless the item keeps the menu open.
  on_close: () => void;
}

// Which radio run each item is in: radio items side by side, broken by a separator or another item.
function radio_runs(items: MenuItem[]): number[] {
  let run = 0;
  return items.map((item, index) => {
    const previous = items[index - 1];
    if (!item.radio || item.separator_before || !previous?.radio) run += 1;
    return run;
  });
}

// A menu's buttons, also for use inside a Popover, such as a column filter's choices; an item that keeps the menu open ticks at once, until new items arrive.
export function MenuList({ items, on_close }: MenuListProps) {
  const [ticks, set_ticks] = useState<{ items: MenuItem[]; checked: Record<string, boolean> }>({ items, checked: {} });
  const checked_now = ticks.items === items ? ticks.checked : {};
  const runs = radio_runs(items);
  const is_checked = (item: MenuItem): boolean | undefined => item.checked === undefined ? undefined : checked_now[item.label] ?? item.checked;

  function tick(item: MenuItem, index: number): void {
    if (item.checked === undefined) return;
    const changes: Record<string, boolean> = item.radio
      ? Object.fromEntries(items.filter((other, other_index) => other.radio && runs[other_index] === runs[index]).map((other) => [other.label, other === item]))
      : { [item.label]: !is_checked(item) };
    set_ticks({ items, checked: { ...checked_now, ...changes } });
  }

  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {item.separator_before && <div className="menu-separator" role="separator" />}
          <button
            type="button"
            className={item.danger ? "menu-item danger" : "menu-item"}
            role={item.checked === undefined ? "menuitem" : item.radio ? "menuitemradio" : "menuitemcheckbox"}
            aria-checked={is_checked(item)}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            onClick={() => {
              if (item.disabled) return;
              if (!item.keep_open) on_close();
              else tick(item, index);
              item.run();
            }}
          >
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  // The point it opens at, such as a mouse event's clientX and clientY.
  x: number;
  y: number;
  items: MenuItem[];
  on_close: () => void;
  label?: string;
}

// Manual, since on Linux the menu opens on the button's press and an auto popover would close on its release.
export function ContextMenu({ x, y, items, on_close, label }: ContextMenuProps) {
  const { element: menu, dismiss, return_focus } = use_popover(on_close, undefined, true);
  const keys = use_menu_keys(menu, dismiss, true);

  useLayoutEffect(() => {
    show_at(menu.current!, x, y);
    menu.current!.querySelector<HTMLElement>(item_selector)?.focus();
  }, [x, y]);

  return (
    <div ref={menu} popover="manual" className="menu" role="menu" aria-label={label} tabIndex={-1} onKeyDown={keys}>
      <MenuList items={items} on_close={() => { return_focus(); on_close(); }} />
    </div>
  );
}

// ── Opening from anywhere ────────────────────────────────────────────────────

interface OpenMenu {
  id: number;
  x: number;
  y: number;
  items: MenuItem[];
  on_close?: () => void;
}

let open_menu: OpenMenu | null = null;
let next_menu_id = 1;
const menu_listeners = new Set<(menu: OpenMenu | null) => void>();

function publish_menu(menu: OpenMenu | null): void {
  const before = open_menu;
  open_menu = menu;
  for (const listener of menu_listeners) listener(open_menu);
  before?.on_close?.();
}

// Opens a menu where the event happened, such as a right-click, replacing any menu already open; on_close hears when it closes for any reason.
export function open_context_menu(event: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[], on_close?: () => void): void {
  event.preventDefault();
  publish_menu({ id: next_menu_id++, x: event.clientX, y: event.clientY, items, on_close });
}

// Where menus opened from anywhere are drawn; the Shell holds one.
export function ContextMenus() {
  const [menu, set_menu] = useState(open_menu);
  useEffect(() => {
    menu_listeners.add(set_menu);
    return () => void menu_listeners.delete(set_menu);
  }, []);
  if (!menu) return null;
  return <ContextMenu key={menu.id} x={menu.x} y={menu.y} items={menu.items} on_close={() => { if (open_menu?.id === menu.id) publish_menu(null); }} />;
}

// ── Popover ──────────────────────────────────────────────────────────────────

interface PopoverProps {
  // The element it hangs from, such as a column's filter button, or else the point it opens at.
  anchor?: HTMLElement | null;
  x?: number;
  y?: number;
  label: string;
  on_close: () => void;
  children: ReactNode;
}

// Holds any content, such as a column's filter, with its first field ready to type into and its menu items reachable by arrow keys.
export function Popover({ anchor, x = 0, y = 0, label, on_close, children }: PopoverProps) {
  const { element: popover, dismiss } = use_popover(on_close, anchor);
  const keys = use_menu_keys(popover, dismiss, false);
  const anchor_name = `--popover-${useId().replace(/[^\w-]/g, "")}`;

  useLayoutEffect(() => {
    const element = popover.current!;
    if (anchor) {
      // The anchor's name ties it to this popover, which CSS then hangs below it, flipping where there is no room.
      anchor.style.setProperty("anchor-name", anchor_name);
      element.style.setProperty("position-anchor", anchor_name);
      element.showPopover();
    } else {
      show_at(element, x, y);
    }
    element.querySelector<HTMLElement>(`input, select, textarea, ${item_selector}, button`)?.focus();
    return () => void anchor?.style.removeProperty("anchor-name");
  }, [anchor, x, y]);

  return (
    <div ref={popover} popover="auto" className={anchor ? "popover anchored" : "popover"} role="dialog" aria-label={label} onKeyDown={keys}>
      {children}
    </div>
  );
}
