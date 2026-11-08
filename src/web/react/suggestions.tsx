// Completions listed under a text field as it is typed into, such as slash commands: arrow keys choose, Tab or Enter take, Escape dismisses.

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

export interface FieldProps<Field extends HTMLElement> {
  "aria-autocomplete": "list";
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-activedescendant": string | undefined;
  onKeyDown: (event: KeyboardEvent<Field>) => void;
  onBlur: (event: FocusEvent<Field>) => void;
}

interface SuggestionsProps<Item, Field extends HTMLElement> {
  // The text the suggestions follow; they are looked up again whenever it changes.
  value: string;
  // What the text could become, at once or later; none hides the list.
  source: (value: string) => Item[] | Promise<Item[]>;
  key_of: (item: Item) => string;
  // The main line and a muted one under it.
  render: (item: Item) => ReactNode;
  detail?: (item: Item) => ReactNode;
  on_take: (item: Item) => void;
  label: string;
  // Keys the list does not use go here, such as Ctrl+Enter.
  on_key_down?: (event: KeyboardEvent<Field>) => void;
  on_blur?: (event: FocusEvent<Field>) => void;
  // Draws the field with the props that tie it to the list.
  children: (field: FieldProps<Field>) => ReactNode;
}

export function Suggestions<Item, Field extends HTMLElement>({ value, source, key_of, render, detail, on_take, label, on_key_down, on_blur, children }: SuggestionsProps<Item, Field>) {
  const list_id = useId();
  const [items, set_items] = useState<Item[]>([]);
  const [index, set_index] = useState(0);
  const latest_value = useRef(value);
  latest_value.current = value;

  useEffect(() => {
    let stale = false;
    Promise.resolve(source(value)).then((found) => {
      if (stale || latest_value.current !== value) return;
      set_items(found);
      set_index(0);
    });
    return () => { stale = true; };
  }, [value]);

  function take(choice: number): void {
    const item = items[choice];
    if (item === undefined) return;
    set_items([]);
    on_take(item);
  }

  function key_down(event: KeyboardEvent<Field>): void {
    if (items.length > 0 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        set_index((index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        take(index);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        set_items([]);
        return;
      }
    }
    on_key_down?.(event);
  }

  const option_id = (position: number) => `${list_id}-${position}`;
  const field: FieldProps<Field> = {
    "aria-autocomplete": "list",
    "aria-expanded": items.length > 0,
    "aria-controls": list_id,
    "aria-activedescendant": items.length > 0 ? option_id(index) : undefined,
    onKeyDown: key_down,
    onBlur: (event) => { set_items([]); on_blur?.(event); },
  };

  return (
    <div className="suggest-wrap">
      {children(field)}
      {items.length > 0 && (
        <ul id={list_id} className="suggestions menu" role="listbox" aria-label={label}>
          {items.map((item, position) => (
            <li
              key={key_of(item)}
              id={option_id(position)}
              role="option"
              className="menu-item"
              aria-selected={position === index}
              onMouseDown={(event) => { event.preventDefault(); take(position); }}
            >
              <span className="suggestion-main">{render(item)}</span>
              {detail && <span className="suggestion-detail muted small">{detail(item)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
