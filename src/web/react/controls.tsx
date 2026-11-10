// React controls drawn like the page's own: segmented choices, switches, search fields, selects, and date, colour and tree pickers.

import { createElement, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { format_month, is_day, is_month, relative_day_label, shift_day, shift_month, this_month, today } from "../../dates.ts";
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

// Options under a heading, drawn as an optgroup; an option may sit under several headings.
export interface OptionGroup<Value extends string | number> {
  label: string;
  options: [value: Value, text: string][];
}

interface SelectProps<Value extends string | number> {
  label: string;
  // Drawn first, outside any group, such as an empty "Pick one…" choice.
  options: [value: Value, text: string][];
  // Drawn after the options, each under its heading; a group with no options is left out.
  groups?: OptionGroup<Value>[];
  value: Value;
  on_change: (value: Value) => void;
  // Only the select, named by label, such as inside a SettingRow that shows the label itself.
  bare?: boolean;
  id?: string;
}

export function Select<Value extends string | number>({ label, options, groups = [], value, on_change, bare = false, id }: SelectProps<Value>) {
  const shown_groups = groups.filter((group) => group.options.length > 0);
  const change = (event: ChangeEvent<HTMLSelectElement>) => {
    const text = event.currentTarget.value;
    const every = [...options, ...shown_groups.flatMap((group) => group.options)];
    on_change((every.find(([option]) => String(option) === text)?.[0] ?? text) as Value);
  };
  const select = (
    <select id={id} value={value} aria-label={bare ? label : undefined} onChange={change}>
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      {shown_groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
        </optgroup>
      ))}
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

interface NumberFieldProps {
  label: string;
  value: number | null;
  // Gets null when the field is emptied, and the value kept within min and max.
  on_change: (value: number | null) => void;
  min?: number;
  max?: number;
  // How far the buttons and arrow keys move it; 1 unless set.
  step?: number;
  // Text after the number, such as "kg".
  unit?: string;
  // Only the field, named by label, such as inside a table row.
  bare?: boolean;
}

function round_to_step(value: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(value.toFixed(decimals));
}

// A number typed with a phone's number keys or moved by a step with the − and + buttons or the arrow keys; it saves once left or on Enter.
export function NumberField({ label, value, on_change, min, max, step = 1, unit, bare = false }: NumberFieldProps) {
  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));

  function commit(text: string): void {
    const trimmed = text.trim().replace(",", ".");
    if (trimmed === "") return on_change(null);
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) on_change(clamp(parsed));
  }

  function nudge(direction: 1 | -1): void {
    on_change(clamp(round_to_step((value ?? min ?? 0) + direction * step, step)));
  }

  function keyed(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") event.currentTarget.blur();
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge(event.key === "ArrowUp" ? 1 : -1);
    }
  }

  const inputs = (
    <div className="number-field-inputs">
      <button type="button" aria-label={`Less ${label.toLowerCase()}`} disabled={value !== null && min !== undefined && value <= min} onClick={() => nudge(-1)}>−</button>
      <input
        key={String(value)}
        type="text"
        inputMode="decimal"
        aria-label={label}
        defaultValue={value ?? ""}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={keyed}
      />
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value !== null && max !== undefined && value >= max} onClick={() => nudge(1)}>+</button>
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
  if (bare) return inputs;
  return (
    <div className="field number-field">
      <span className="field-label">{label}</span>
      {inputs}
    </div>
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
        {day && <button type="button" className="icon remove" aria-label={`Clear ${label.toLowerCase()} date`} onClick={() => on_change(null)}>×</button>}
      </div>
    </div>
  );
}

interface PeriodStepperProps {
  label: string;
  // A day steps "2026-06-10" a day at a time; a month steps "2026-06" a month at a time.
  period: "day" | "month";
  value: string;
  on_change: (value: string) => void;
  // The clock Today or This month goes back to; the device's own unless set.
  now?: Date;
  locale?: string;
}

// A day or month stepped back and forward, picked from the calendar, or brought back to the current one, named in words beside.
export function PeriodStepper({ label, period, value, on_change, now, locale }: PeriodStepperProps) {
  const is_daily = period === "day";
  const current = is_daily ? today(now) : this_month(now);
  const shift = (steps: number) => on_change(is_daily ? shift_day(value, steps) : shift_month(value, steps));
  const pick = (text: string) => {
    if (is_daily ? is_day(text) : is_month(text)) on_change(text);
  };

  return (
    <div className="stepper" role="group" aria-label={label}>
      <div className="date-time-inputs">
        <button type="button" aria-label={`Previous ${period}`} onClick={() => shift(-1)}>‹</button>
        <input type={is_daily ? "date" : "month"} aria-label={`Pick a ${period}`} value={value} onChange={(event) => pick(event.currentTarget.value)} />
        <button type="button" aria-label={`Next ${period}`} onClick={() => shift(1)}>›</button>
      </div>
      <button type="button" disabled={value === current} onClick={() => on_change(current)}>{is_daily ? "Today" : "This month"}</button>
      <span className="muted">{is_daily ? relative_day_label(value, now, locale) : format_month(value, locale)}</span>
    </div>
  );
}

interface PathInputProps {
  label: string;
  value: string;
  on_change: (value: string) => void;
  // Opens the app's file or folder picker and gives back the path chosen, or null when the user cancelled.
  pick: (current: string) => Promise<string | null>;
  placeholder?: string;
  disabled?: boolean;
  browse_label?: string;
}

// A path typed by hand or picked through a Browse button.
export function PathInput({ label, value, on_change, pick, placeholder, disabled = false, browse_label = "Browse…" }: PathInputProps) {
  const [picking, set_picking] = useState(false);

  async function browse(): Promise<void> {
    set_picking(true);
    try {
      const chosen = await pick(value);
      if (chosen !== null) on_change(chosen);
    } finally {
      set_picking(false);
    }
  }

  return (
    <span className="path-row">
      <input type="text" aria-label={label} spellCheck={false} placeholder={placeholder} disabled={disabled} value={value} onChange={(event) => on_change(event.currentTarget.value)} />
      <button type="button" disabled={disabled || picking} onClick={() => void browse()}>{browse_label}</button>
    </span>
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

  // The open list indents each name by its depth, and the closed face shows the picked choice's whole path.
  return (
    <select className="tree-select" aria-label={label} value={value} title={chosen ? path_names(chosen, items, name_of).join(" › ") : undefined} onChange={(event) => on_change(event.currentTarget.value)}>
      <button type="button">{createElement("selectedcontent")}</button>
      <option value="">{blank_label}</option>
      {in_tree_order(items).map((item) => (
        <option key={item.id} value={item.id} disabled={disabled_ids.includes(item.id)} title={path_names(item, items, name_of).join(" › ")} style={{ "--depth": depth_of(item) } as CSSProperties}>
          <span className="tree-option-name">{name_of(item)}</span>
          <span className="tree-option-path">{path_names(item, items, name_of).join(" › ")}</span>
        </option>
      ))}
    </select>
  );
}

interface TreePickerProps<Item extends TreeItem> {
  label: string;
  items: Item[];
  name_of: (item: Item) => string;
  // The chosen item's id, or "" for none.
  value: string;
  // Shown in the empty field while nothing is chosen, such as "Choose a task…".
  placeholder: string;
  // Shown greyed and passed over, keeping their children in place.
  disabled_ids?: readonly string[];
  auto_focus?: boolean;
  on_change: (id: string) => void;
}

interface TreePickerRow<Item> {
  item: Item;
  depth: number;
  // False for a parent shown only to place a match under it.
  is_match: boolean;
}

// The items whose names hold the search, in tree order with the parents above them.
function tree_picker_rows<Item extends TreeItem>(items: Item[], name_of: (item: Item) => string, search: string): TreePickerRow<Item>[] {
  const words = search.trim().toLocaleLowerCase();
  const item_by_id = new Map(items.map((item) => [item.id, item]));
  const matched_ids = new Set(items.filter((item) => name_of(item).toLocaleLowerCase().includes(words)).map((item) => item.id));
  const shown_ids = new Set(matched_ids);

  for (const id of matched_ids) {
    let parent_id = item_by_id.get(id)!.parent_id;
    while (parent_id !== null && item_by_id.has(parent_id) && !shown_ids.has(parent_id)) {
      shown_ids.add(parent_id);
      parent_id = item_by_id.get(parent_id)!.parent_id;
    }
  }

  return in_tree_order(items)
    .filter((item) => shown_ids.has(item.id))
    .map((item) => ({ item, depth: path_names(item, items, name_of).length - 1, is_match: matched_ids.has(item.id) }));
}

// A search field over a tree: typing narrows the indented list to matching names under their parents, and arrows and Enter pick one.
export function TreePicker<Item extends TreeItem>({ label, items, name_of, value, placeholder, disabled_ids = [], auto_focus, on_change }: TreePickerProps<Item>) {
  const list_id = useId();
  const anchor_name = `--tree-picker-${list_id.replace(/[^\w-]/g, "")}`;
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // The text typed since the field took focus, or null while the list is closed.
  const [search, set_search] = useState<string | null>(null);
  const [active_id, set_active_id] = useState("");

  const path_of = (item: Item) => path_names(item, items, name_of).join(" › ");
  const chosen = items.find((item) => item.id === value);
  const is_open = search !== null;
  const rows = is_open ? tree_picker_rows(items, name_of, search) : [];
  const can_pick = (row: TreePickerRow<Item>) => row.is_match && !disabled_ids.includes(row.item.id);
  const pickable = rows.filter(can_pick);
  const active = pickable.find((row) => row.item.id === active_id) ?? pickable.find((row) => row.item.id === value) ?? pickable[0];
  const option_id = (item: Item) => `${list_id}-${item.id}`;

  // The list hangs below the field in the top layer, so a dialog around it does not cut it off.
  useLayoutEffect(() => {
    if (!is_open || !field.current || !list.current) return;
    field.current.style.setProperty("anchor-name", anchor_name);
    list.current.style.setProperty("position-anchor", anchor_name);
    list.current.showPopover();
  }, [is_open]);

  useEffect(() => {
    if (active) document.getElementById(option_id(active.item))?.scrollIntoView?.({ block: "nearest" });
  }, [active?.item.id]);

  function open(): void {
    set_search("");
    set_active_id("");
  }

  function pick(item: Item): void {
    set_search(null);
    on_change(item.id);
  }

  function key_down(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!is_open) return open();
      if (pickable.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const index = active ? pickable.indexOf(active) : -1;
      set_active_id(pickable[(index + step + pickable.length) % pickable.length]!.item.id);
      return;
    }
    if (event.key === "Enter" && is_open) {
      event.preventDefault();
      if (active) pick(active.item);
      return;
    }
    if (event.key === "Escape" && is_open) {
      event.preventDefault();
      event.stopPropagation();
      set_search(null);
    }
  }

  // The closed field shows the chosen path; the open one searches, with that path left as its placeholder.
  return (
    <div className="tree-picker">
      <input
        ref={field}
        type="text"
        role="combobox"
        className="tree-picker-field"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={is_open}
        aria-controls={list_id}
        aria-activedescendant={active ? option_id(active.item) : undefined}
        value={search ?? (chosen ? path_of(chosen) : "")}
        placeholder={chosen ? path_of(chosen) : placeholder}
        title={chosen ? path_of(chosen) : undefined}
        autoFocus={auto_focus}
        autoComplete="off"
        onFocus={open}
        onClick={() => !is_open && open()}
        onBlur={() => set_search(null)}
        onChange={(event) => {
          set_search(event.currentTarget.value);
          set_active_id("");
        }}
        onKeyDown={key_down}
      />
      {is_open && (
        <ul ref={list} id={list_id} popover="manual" role="listbox" aria-label={label} className="menu tree-picker-list">
          {rows.length === 0 && <li className="tree-picker-empty">No matches</li>}
          {rows.map((row) => (
            <li
              key={row.item.id}
              id={option_id(row.item)}
              role="option"
              className={row.item.id === value ? "menu-item chosen" : "menu-item"}
              aria-selected={row === active}
              aria-disabled={can_pick(row) ? undefined : true}
              title={path_of(row.item)}
              style={{ "--depth": row.depth } as CSSProperties}
              onMouseDown={(event) => {
                event.preventDefault();
                if (can_pick(row)) pick(row.item);
              }}
            >
              {name_of(row.item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
