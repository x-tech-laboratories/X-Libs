// React controls drawn like the page's own: segmented choices, switches, search fields, selects, and date, colour and tree pickers.

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { in_tree_order, path_names, type TreeItem } from "../tree.ts";

// ── Choices ──────────────────────────────────────────────────────────────────

interface SegmentedProps<Value extends string> {
  label: string;
  choices: { value: Value; label: string }[];
  value: Value;
  on_change: (value: Value) => void;
  // An extra class, such as one that shows the control only on phones.
  class_name?: string;
}

// One of a few choices side by side; the chosen one takes the accent.
export function Segmented<Value extends string>({ label, choices, value, on_change, class_name }: SegmentedProps<Value>) {
  return (
    <div className={class_name ? `segmented ${class_name}` : "segmented"} role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} onClick={() => on_change(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

// Buttons joined into one control, such as zoom out, zoom in and fit.
export function ButtonGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="segmented" role="group" aria-label={label}>{children}</div>;
}

// ── Switches ─────────────────────────────────────────────────────────────────

interface SwitchProps {
  label: string;
  checked: boolean;
  // Resolves false, or throws, when the change did not take, which flips the switch back.
  on_change: (on: boolean) => Promise<boolean | void> | boolean | void;
  disabled?: boolean;
}

export function Switch({ label, checked, on_change, disabled = false }: SwitchProps) {
  const [busy, set_busy] = useState(false);

  async function change(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const box = event.currentTarget;
    const on = box.checked;
    set_busy(true);
    try {
      if ((await on_change(on)) === false) box.checked = !on;
    } catch (error) {
      box.checked = !on;
      throw error;
    } finally {
      set_busy(false);
    }
  }

  return <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled || busy} onChange={change} />;
}

// ── Filters ──────────────────────────────────────────────────────────────────

interface SearchBoxProps {
  label: string;
  value: string;
  // Hands on the text as it is typed, once typing pauses, for a list filtered live.
  on_input?: (value: string) => void;
  // Hands on the text when Enter is pressed or the button is clicked, and "" once a submitted search is cleared.
  on_submit?: (value: string) => void;
  // Takes a whole paste instead of the field, such as a link that opens straight away; true means it did.
  on_paste?: (text: string) => boolean;
  // A button beside the field that submits it, such as "Search".
  submit_label?: string;
  // Empties the field once submitted, such as a search that leads to another page.
  clear_on_submit?: boolean;
  // Takes focus when it first shows, such as on a page where searching comes first.
  auto_focus?: boolean;
}

// A search field that hands on what was typed once typing pauses and submits it on Enter; Escape clears it; the field keeps its own text, so a redraw never wipes typing, and shows a value changed from outside, such as one cleared.
export function SearchBox({ label, value, on_input, on_submit, on_paste, submit_label, clear_on_submit = false, auto_focus = false }: SearchBoxProps) {
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const handed_on = useRef(value);
  const submitted = useRef(value);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (value === handed_on.current || !field.current) return;
    clearTimeout(timer.current);
    handed_on.current = value;
    submitted.current = value;
    field.current.value = value;
  }, [value]);

  function hand_on(text: string): void {
    clearTimeout(timer.current);
    if (text === handed_on.current) return;
    handed_on.current = text;
    on_input?.(text);
  }

  function submit(): void {
    const text = field.current?.value ?? "";
    hand_on(text);
    submitted.current = clear_on_submit ? "" : text;
    on_submit?.(text);
    if (clear_on_submit && field.current) {
      field.current.value = "";
      handed_on.current = "";
    }
  }

  function clear(): void {
    if (!field.current) return;
    field.current.value = "";
    hand_on("");
    if (submitted.current !== "") {
      submitted.current = "";
      on_submit?.("");
    }
  }

  function typed(event: ChangeEvent<HTMLInputElement>): void {
    clearTimeout(timer.current);
    const text = event.currentTarget.value;
    // An emptied field goes straight back to everything, taking back what was submitted.
    if (text === "") return clear();
    if (!on_input) return;
    timer.current = window.setTimeout(() => hand_on(text), 200);
  }

  function keyed(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && event.currentTarget.value !== "") {
      event.preventDefault();
      clear();
    }
  }

  function pasted(event: ClipboardEvent<HTMLInputElement>): void {
    if (on_paste?.(event.clipboardData.getData("text"))) event.preventDefault();
  }

  const input = (
    <input
      ref={field}
      type="search"
      className="filter"
      placeholder={label}
      aria-label={label}
      defaultValue={value}
      autoFocus={auto_focus}
      onChange={typed}
      onKeyDown={keyed}
      onPaste={on_paste && pasted}
    />
  );
  if (!submit_label) return input;
  return (
    <form className="search-box" role="search" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {input}
      <button type="submit" className="accent solid">{submit_label}</button>
    </form>
  );
}

interface SelectProps<Value extends string | number> {
  label: string;
  options: [value: Value, text: string][];
  value: Value;
  on_change: (value: Value) => void;
  // Only the select, named by label, such as inside a SettingRow that shows the label itself.
  bare?: boolean;
}

export function Select<Value extends string | number>({ label, options, value, on_change, bare = false }: SelectProps<Value>) {
  const change = (event: ChangeEvent<HTMLSelectElement>) => {
    const text = event.currentTarget.value;
    on_change((options.find(([option]) => String(option) === text)?.[0] ?? text) as Value);
  };
  const select = (
    <select value={value} aria-label={bare ? label : undefined} onChange={change}>
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select>
  );
  if (bare) return select;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {select}
    </label>
  );
}

// ── Fields ───────────────────────────────────────────────────────────────────

type CommitInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value: string | number;
  on_commit: (event: { currentTarget: HTMLInputElement }) => void;
};

// A field that saves once it is left or Enter is pressed, as a native change event does, and shows the saved value again whenever that changes.
export function CommitInput({ value, on_commit, onBlur, onKeyDown, ...rest }: CommitInputProps) {
  return (
    <input
      {...rest}
      key={String(value)}
      defaultValue={value}
      onBlur={(event) => { onBlur?.(event); on_commit(event); }}
      onKeyDown={(event) => { onKeyDown?.(event); if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

interface DateTimeFieldProps {
  label: string;
  // A local day such as "2026-06-10", or a day and time such as "2026-06-10T09:30".
  value: string | null;
  on_change: (value: string | null) => void;
  // Whether a time input appears once a day is set.
  allow_time?: boolean;
}

// A local date with an optional time and a clear button; clearing the date clears the time.
export function DateTimeField({ label, value, on_change, allow_time = true }: DateTimeFieldProps) {
  const [day = "", time = ""] = (value ?? "").split("T");
  const join = (next_day: string, next_time: string) => on_change(next_day ? (next_time && allow_time ? `${next_day}T${next_time}` : next_day) : null);

  return (
    <div className="field date-time-field">
      <span className="field-label">{label}</span>
      <div className="date-time-inputs">
        <input type="date" aria-label={`${label} date`} value={day} onChange={(event) => join(event.currentTarget.value, time)} />
        {day && allow_time && <input type="time" aria-label={`${label} time`} value={time} onChange={(event) => join(day, event.currentTarget.value)} />}
        {day && <button type="button" className="icon" aria-label={`Clear ${label.toLowerCase()} date`} onClick={() => on_change(null)}>×</button>}
      </div>
    </div>
  );
}

// ── Pickers ──────────────────────────────────────────────────────────────────

interface ColorPickerProps {
  label: string;
  value: string | null;
  swatches: string[];
  on_change: (color: string | null) => void;
  // Whether a No colour choice comes first.
  allow_none?: boolean;
}

// Swatches, a None choice, and the system colour chooser for any other colour.
export function ColorPicker({ label, value, swatches, on_change, allow_none = true }: ColorPickerProps) {
  const is_swatch = value !== null && swatches.some((swatch) => swatch.toLowerCase() === value.toLowerCase());
  const custom = value !== null && !is_swatch;

  return (
    <div className="color-picker" role="radiogroup" aria-label={label}>
      {allow_none && <button type="button" role="radio" className="color-swatch none" aria-checked={value === null} aria-label="No colour" onClick={() => on_change(null)} />}
      {swatches.map((swatch) => (
        <button
          key={swatch}
          type="button"
          role="radio"
          className="color-swatch"
          style={{ "--swatch-color": swatch } as CSSProperties}
          aria-checked={value !== null && swatch.toLowerCase() === value.toLowerCase()}
          aria-label={swatch}
          title={swatch}
          onClick={() => on_change(swatch)}
        />
      ))}
      <input type="color" className={custom ? "color-custom chosen" : "color-custom"} aria-label="Other colour" value={value ?? "#888888"} onChange={(event) => on_change(event.currentTarget.value)} />
    </div>
  );
}

interface TreeSelectProps<Item extends TreeItem> {
  label: string;
  items: Item[];
  name_of: (item: Item) => string;
  // The chosen item's id, or "" for the blank choice.
  value: string;
  blank_label: string;
  // Shown greyed, keeping their children in place.
  disabled_ids?: readonly string[];
  on_change: (id: string) => void;
}

// A select listing a tree indented, each choice's whole path on hover and in the closed select.
export function TreeSelect<Item extends TreeItem>({ label, items, name_of, value, blank_label, disabled_ids = [], on_change }: TreeSelectProps<Item>) {
  const depth_of = (item: Item) => path_names(item, items, name_of).length - 1;
  const chosen = items.find((item) => item.id === value);

  return (
    <select className="tree-select" aria-label={label} value={value} title={chosen ? path_names(chosen, items, name_of).join(" › ") : undefined} onChange={(event) => on_change(event.currentTarget.value)}>
      <option value="">{blank_label}</option>
      {in_tree_order(items).map((item) => (
        <option key={item.id} value={item.id} disabled={disabled_ids.includes(item.id)} title={path_names(item, items, name_of).join(" › ")}>
          {`${"\u2003".repeat(depth_of(item))}${name_of(item)}`}
        </option>
      ))}
    </select>
  );
}
