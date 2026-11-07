// Preact controls drawn like the page's own: segmented choices, switches and search fields.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

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
    <div class={class_name ? `segmented ${class_name}` : "segmented"} role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} onClick={() => on_change(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

// Buttons joined into one control, such as zoom out, zoom in and fit.
export function ButtonGroup({ label, children }: { label: string; children: ComponentChildren }) {
  return <div class="segmented" role="group" aria-label={label}>{children}</div>;
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

  async function change(event: Event): Promise<void> {
    const box = event.currentTarget as HTMLInputElement;
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
  on_input: (value: string) => void;
}

// A search field that hands on what was typed once typing pauses; the field keeps its own text, so a redraw never wipes typing.
export function SearchBox({ label, value, on_input }: SearchBoxProps) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <input
      type="search"
      class="filter"
      placeholder={label}
      aria-label={label}
      defaultValue={value}
      onInput={(event) => {
        clearTimeout(timer.current);
        const text = (event.currentTarget as HTMLInputElement).value;
        timer.current = window.setTimeout(() => on_input(text), 200);
      }}
    />
  );
}

interface SelectProps<Value extends string> {
  label: string;
  options: [value: Value, text: string][];
  value: Value;
  on_change: (value: Value) => void;
}

export function Select<Value extends string>({ label, options, value, on_change }: SelectProps<Value>) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      <select value={value} onChange={(event) => on_change((event.currentTarget as HTMLSelectElement).value as Value)}>
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </label>
  );
}
