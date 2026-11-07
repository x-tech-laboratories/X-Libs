// Menus and popovers on the native popover: closed by Escape or a click elsewhere, and here also by scrolling or leaving the window.

import { Fragment, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { on_screen_position, type MenuItem } from "../menus.ts";

export type { MenuItem } from "../menus.ts";

// ── Opening ──────────────────────────────────────────────────────────────────

// Shows the element as a popover while it is rendered, calling the latest on_close once it closes for any reason.
function use_popover(on_close: () => void): RefObject<HTMLDivElement | null> {
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(on_close);
  close.current = on_close;

  useEffect(() => {
    const popover = element.current!;
    const hide = () => { if (popover.matches(":popover-open")) popover.hidePopover(); };
    const toggled = (event: Event) => { if ((event as ToggleEvent).newState === "closed") close.current(); };
    const outside_scroll = (event: Event) => { if (!popover.contains(event.target as Node)) hide(); };
    popover.addEventListener("toggle", toggled);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", outside_scroll, true);
    return () => {
      popover.removeEventListener("toggle", toggled);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", outside_scroll, true);
    };
  }, []);
  return element;
}

// Shows the popover at the point, flipped or pushed back so it stays on screen.
function show_at(popover: HTMLElement, x: number, y: number): void {
  if (!popover.matches(":popover-open")) popover.showPopover();
  const size = popover.getBoundingClientRect();
  const position = on_screen_position(x, y, size.width, size.height);
  popover.style.left = `${position.left}px`;
  popover.style.top = `${position.top}px`;
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  // The point it opens at, such as a mouse event's clientX and clientY.
  x: number;
  y: number;
  items: MenuItem[];
  on_close: () => void;
}

export function ContextMenu({ x, y, items, on_close }: ContextMenuProps) {
  const menu = use_popover(on_close);
  useLayoutEffect(() => {
    show_at(menu.current!, x, y);
    menu.current!.querySelector<HTMLElement>(".menu-item:not(:disabled)")?.focus();
  }, [x, y]);

  return (
    <div ref={menu} popover="auto" className="menu" role="menu" tabIndex={-1}>
      {items.map((item) => (
        <Fragment key={item.label}>
          {item.separator_before && <div className="menu-separator" role="separator" />}
          <button
            type="button"
            className={item.danger ? "menu-item danger" : "menu-item"}
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            disabled={item.disabled}
            onClick={() => {
              on_close();
              item.run();
            }}
          >
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
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

// Holds any content, such as a column's filter, with its first field ready to type into.
export function Popover({ anchor, x = 0, y = 0, label, on_close, children }: PopoverProps) {
  const popover = use_popover(on_close);
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
    element.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => void anchor?.style.removeProperty("anchor-name");
  }, [anchor, x, y]);

  return (
    <div ref={popover} popover="auto" className={anchor ? "popover anchored" : "popover"} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
