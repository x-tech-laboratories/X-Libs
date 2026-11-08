// A button that opens a menu under itself, such as the ⋮ on a card; the Shell draws the menu.

import type { MouseEvent, ReactNode } from "react";
import { open_context_menu, type MenuItem } from "./menus.tsx";

interface MenuButtonProps {
  label: string;
  // The items, or a function that builds them as the menu opens.
  items: MenuItem[] | (() => MenuItem[]);
  // What the button shows, the three dots unless told otherwise.
  glyph?: ReactNode;
  class_name?: string;
}

export function MenuButton({ label, items, glyph = "⋮", class_name }: MenuButtonProps) {
  function open(event: MouseEvent<HTMLButtonElement>): void {
    // The button may sit inside a link, such as a whole card that opens its video.
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    open_context_menu({ clientX: box.left, clientY: box.bottom, preventDefault: () => {} }, typeof items === "function" ? items() : items);
  }

  return (
    <button type="button" className={class_name ? `icon menu-trigger ${class_name}` : "icon menu-trigger"} aria-label={label} title={label} aria-haspopup="menu" onClick={open}>
      {glyph}
    </button>
  );
}
