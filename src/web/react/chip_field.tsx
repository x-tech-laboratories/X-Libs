// A list of short values, such as tags or muscles, as removable chips with a field under them that suggests more and
// an Add button beside it; the field takes free text as well as a suggestion.

import { useMemo, useState } from "react";
import { Chip, Chips } from "./badges.tsx";
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
