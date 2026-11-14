// A list of short values, such as tags or muscles, as removable chips with a field under them that suggests more and
// an Add button beside it; the field takes free text as well as a suggestion. TreeChipField does the same for items of a
// tree, such as nested categories, each chip showing its whole path.

import { useMemo, useState } from "react";
import { path_names, type TreeItem } from "../tree.ts";
import { Chip, Chips } from "./badges.tsx";
import { TreePicker } from "./controls.tsx";
import { PathText } from "./layout.tsx";
import { ComboField } from "./suggestions.tsx";

interface ChipFieldProps {
  label: string;
  values: string[];
  on_change: (values: string[]) => void;
  // Values to suggest; those already chosen are left out.
  suggestions: string[];
  // The text being typed, when the form keeps it, such as to save a value still in the field with with_draft; the
  // field keeps its own otherwise.
  draft?: string;
  on_draft?: (draft: string) => void;
  // false lists suggestions only once something is typed.
  list_on_focus?: boolean;
  placeholder?: string;
  add_label?: string;
  // Shown in place of the chips while there are none.
  empty_text?: string;
  // Lets a form's own <label htmlFor> name the field.
  id?: string;
}

export function ChipField({ label, values, on_change, suggestions, draft, on_draft, list_on_focus = true, placeholder, add_label = "Add", empty_text = "None.", id }: ChipFieldProps) {
  const [own_draft, set_own_draft] = useState("");
  const text = draft ?? own_draft;
  const set_text = (next: string) => (on_draft ? on_draft(next) : set_own_draft(next));
  const unused = useMemo(() => suggestions.filter((item) => !values.includes(item)), [suggestions, values]);

  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !values.includes(trimmed)) on_change([...values, trimmed]);
    set_text("");
  };

  return (
    <div className="chip-field" role="group" aria-label={label}>
      <Chips>
        {values.length === 0 && <span className="muted small">{empty_text}</span>}
        {values.map((value) => (
          <Chip key={value} on_remove={() => on_change(values.filter((item) => item !== value))} remove_label={`Remove ${value}`}>
            {value}
          </Chip>
        ))}
      </Chips>
      <div className="chip-field-add">
        <ComboField id={id} label={label} value={text} options={unused} list_on_focus={list_on_focus} placeholder={placeholder} on_change={set_text} on_take={add} on_enter={() => add(text)} />
        <button type="button" disabled={!text.trim()} onClick={() => add(text)}>
          {add_label}
        </button>
      </div>
    </div>
  );
}

// The values with a draft still in the field taken in, such as when a form is saved before Add is pressed.
export function with_draft(values: string[], draft: string): string[] {
  const trimmed = draft.trim();
  return trimmed && !values.includes(trimmed) ? [...values, trimmed] : values;
}

// ── Trees ────────────────────────────────────────────────────────────────────

interface TreeChipFieldProps<Item extends TreeItem> {
  label: string;
  items: Item[];
  name_of: (item: Item) => string;
  // The chosen items' ids; a value naming no item, such as text still to be made into one, shows as it is.
  values: string[];
  on_change: (values: string[]) => void;
  placeholder?: string;
  empty_text?: string;
  // Lets the typed text be added as a value of its own when no name matches it.
  can_create?: boolean;
}

// Chips showing each chosen item's path, and a field that searches the tree for one more.
export function TreeChipField<Item extends TreeItem>({ label, items, name_of, values, on_change, placeholder = "Add…", empty_text = "None.", can_create = false }: TreeChipFieldProps<Item>) {
  const item_by_id = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const names_of = (value: string) => {
    const item = item_by_id.get(value);
    return item ? path_names(item, items, name_of) : [value];
  };
  const add = (value: string) => {
    if (value && !values.includes(value)) on_change([...values, value]);
  };

  return (
    <div className="chip-field" role="group" aria-label={label}>
      <Chips>
        {values.length === 0 && <span className="muted small">{empty_text}</span>}
        {values.map((value) => (
          <Chip key={value} on_remove={() => on_change(values.filter((item) => item !== value))} remove_label={`Remove ${names_of(value).join(" › ")}`}>
            <PathText names={names_of(value)} />
          </Chip>
        ))}
      </Chips>
      <TreePicker label={label} items={items} name_of={name_of} value="" placeholder={placeholder} disabled_ids={values} on_change={add} on_create={can_create ? (text) => add(text) : undefined} />
    </div>
  );
}
