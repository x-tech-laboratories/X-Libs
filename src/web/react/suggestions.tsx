// Completions listed under a text field as it is typed into, such as slash commands: arrow keys choose, Tab or Enter take, Escape dismisses.
// With open_on_focus the list opens as soon as the field is entered, nothing lit until an arrow key picks one, so Enter
// still hands on free text; ComboField is that mode over a list of known values, such as categories already in use.

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

export interface FieldProps<Field extends HTMLElement> {
  "aria-autocomplete": "list";
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-activedescendant": string | undefined;
  onKeyDown: (event: KeyboardEvent<Field>) => void;
  onBlur: (event: FocusEvent<Field>) => void;
  // Given only with open_on_focus: entering, clicking or typing into the field opens the list.
  onFocus?: () => void;
  onClick?: () => void;
  onInput?: () => void;
}

interface SuggestionsProps<Item, Field extends HTMLElement> {
  // The text the suggestions follow; they are looked up again whenever it changes.
  value: string;
  // What the text could become, at once or later; none hides the list.
  source: (value: string) => Item[] | Promise<Item[]>;
  // Looks the suggestions up again when it changes too, such as when the values they come from do.
  lookup_key?: string;
  key_of: (item: Item) => string;
  // The main line and a muted one under it.
  render: (item: Item) => ReactNode;
  detail?: (item: Item) => ReactNode;
  on_take: (item: Item) => void;
  label: string;
  // Keys the list does not use go here, such as Ctrl+Enter, or Enter with nothing lit when open_on_focus.
  on_key_down?: (event: KeyboardEvent<Field>) => void;
  on_blur?: (event: FocusEvent<Field>) => void;
  // Opens the list when the field is entered or clicked, rather than only as it is typed into, with nothing lit at
  // first; Escape closes it and an arrow key opens it again.
  open_on_focus?: boolean;
  // Draws the field with the props that tie it to the list.
  children: (field: FieldProps<Field>) => ReactNode;
}

export function Suggestions<Item, Field extends HTMLElement>({ value, source, lookup_key, key_of, render, detail, on_take, label, on_key_down, on_blur, open_on_focus = false, children }: SuggestionsProps<Item, Field>) {
  const list_id = useId();
  const [items, set_items] = useState<Item[]>([]);
  // Nothing is lit at -1, which only open_on_focus starts from.
  const first = open_on_focus ? -1 : 0;
  const [index, set_index] = useState(first);
  // Only open_on_focus waits for the field to be entered; otherwise any items show.
  const [open, set_open] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const latest_value = useRef(value);
  latest_value.current = value;

  useEffect(() => {
    let stale = false;
    Promise.resolve(source(value)).then((found) => {
      if (stale || latest_value.current !== value) return;
      set_items(found);
      set_index(first);
    });
    return () => { stale = true; };
  }, [value, lookup_key]);

  const shown = items.length > 0 && (open || !open_on_focus);

  // A long list keeps the lit option in sight.
  useEffect(() => {
    if (shown && index >= 0) list.current?.children[index]?.scrollIntoView?.({ block: "nearest" });
  }, [shown, index]);

  function close(): void {
    if (open_on_focus) set_open(false);
    else set_items([]);
    set_index(first);
  }

  function take(choice: number): void {
    const item = items[choice];
    if (item === undefined) return;
    close();
    on_take(item);
  }

  function key_down(event: KeyboardEvent<Field>): void {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (plain && open_on_focus && !shown && items.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      set_open(true);
      return;
    }
    if (shown && plain) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        // With nothing lit as a stop, past either end comes back to the text as typed.
        const stops = items.length - first;
        set_index(((index - first + step + stops) % stops) + first);
        return;
      }
      if ((event.key === "Tab" || event.key === "Enter") && index >= 0) {
        event.preventDefault();
        take(index);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      // Only open_on_focus gets here, with nothing lit: the key goes on and the list closes.
      if (event.key === "Enter" || event.key === "Tab") close();
    }
    on_key_down?.(event);
  }

  const opener = () => {
    set_open(true);
    set_index(first);
  };
  const option_id = (position: number) => `${list_id}-${position}`;
  const field: FieldProps<Field> = {
    "aria-autocomplete": "list",
    "aria-expanded": shown,
    "aria-controls": list_id,
    "aria-activedescendant": shown && index >= 0 ? option_id(index) : undefined,
    onKeyDown: key_down,
    onBlur: (event) => { close(); on_blur?.(event); },
    ...(open_on_focus && { onFocus: opener, onClick: () => set_open(true), onInput: opener }),
  };

  return (
    <div className="suggest-wrap">
      {children(field)}
      {shown && (
        <ul ref={list} id={list_id} className={open_on_focus ? "suggestions menu list-all" : "suggestions menu"} role="listbox" aria-label={label}>
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

// ── Combo field ──────────────────────────────────────────────────────────────

interface ComboFieldProps {
  label: string;
  value: string;
  // The values known, such as those already in use: listed in full when the field is entered and narrowed to those
  // holding the text as it is typed, ignoring case. Anything else can still be typed.
  options: string[];
  on_change: (value: string) => void;
  // A value taken from the list; on_change when not given. A chip field adds it at once, say.
  on_take?: (value: string) => void;
  // Enter with nothing lit, such as to add what was typed.
  on_enter?: () => void;
  on_blur?: () => void;
  // false lists only once something is typed, for a long list whose whole would be noise.
  list_on_focus?: boolean;
  // At most this many listed.
  limit?: number;
  placeholder?: string;
  // Lets a form's own <label htmlFor> name the field; label still names it otherwise.
  id?: string;
}

// A text field that offers known values in a list under it and takes free text; arrow keys pick, Enter or Tab take
// the lit one, Escape closes the list, and Enter with nothing lit goes to on_enter.
export function ComboField({ label, value, options, on_change, on_take, on_enter, on_blur, list_on_focus = true, limit, placeholder, id }: ComboFieldProps) {
  const source = (text: string): string[] => {
    const needle = text.trim().toLowerCase();
    if (!needle && !list_on_focus) return [];
    const matches = needle ? options.filter((option) => option.toLowerCase().includes(needle)) : options;
    return limit === undefined ? matches : matches.slice(0, limit);
  };
  return (
    <Suggestions<string, HTMLInputElement>
      value={value}
      source={source}
      lookup_key={`${list_on_focus}\u0000${limit}\u0000${options.join("\u0000")}`}
      key_of={(option) => option}
      render={(option) => option}
      on_take={on_take ?? on_change}
      label={label}
      open_on_focus
      on_blur={on_blur}
      on_key_down={(event) => {
        if (event.key === "Enter" && on_enter) {
          event.preventDefault();
          on_enter();
        }
      }}
    >
      {(field) => (
        <input
          {...field}
          id={id}
          type="text"
          role="combobox"
          aria-label={label}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(event) => on_change(event.currentTarget.value)}
        />
      )}
    </Suggestions>
  );
}
