// Preact menus and popovers opened at a point, kept on screen and closed the same way as the page's own.

import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { dismiss_on_outside, menu_item_class, menu_item_role, place_on_screen, type MenuItem } from "../menus.ts";

export type { MenuItem } from "../menus.ts";

// ── Placing ──────────────────────────────────────────────────────────────────

// Keeps the element on screen at the point, and calls the latest on_close when it should close.
function use_floating(x: number, y: number, on_close: () => void) {
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(on_close);
  close.current = on_close;

  useLayoutEffect(() => place_on_screen(element.current!, x, y), [x, y]);
  useEffect(() => dismiss_on_outside(element.current!, () => close.current()), []);
  return element;
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  on_close: () => void;
}

export function ContextMenu({ x, y, items, on_close }: ContextMenuProps) {
  const menu = use_floating(x, y, on_close);
  useEffect(() => menu.current?.querySelector<HTMLElement>(".menu-item:not(:disabled)")?.focus(), []);

  return (
    <div ref={menu} class="menu" role="menu" tabIndex={-1}>
      {items.map((item) => (
        <Fragment key={item.label}>
          {item.separator_before && <div class="menu-separator" role="separator" />}
          <button
            type="button"
            class={menu_item_class(item)}
            role={menu_item_role(item)}
            aria-checked={item.checked === undefined ? undefined : item.checked}
            disabled={item.disabled}
            onClick={() => {
              on_close();
              item.run();
            }}
          >
            <span class="menu-label">{item.label}</span>
            {item.hint && <span class="menu-hint">{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────

interface PopoverProps {
  x: number;
  y: number;
  label: string;
  on_close: () => void;
  children: ComponentChildren;
}

// Holds any content, such as a column's filter, with its first field ready to type into.
export function Popover({ x, y, label, on_close, children }: PopoverProps) {
  const popover = use_floating(x, y, on_close);
  useEffect(() => popover.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus(), []);

  return (
    <div ref={popover} class="popover" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
