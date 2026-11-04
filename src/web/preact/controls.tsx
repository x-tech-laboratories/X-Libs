// Preact controls drawn like the page's own: segmented choices, switches and search fields.

import { useRef, useState } from "preact/hooks";

// ── Choices ──────────────────────────────────────────────────────────────────

interface SegmentedProps<Value extends string> {
  label: string;
  choices: { value: Value; label: string }[];
  value: Value;
  on_change: (value: Value) => void;
}

// One of a few choices side by side; the chosen one takes the accent.
export function Segmented<Value extends string>({ label, choices, value, on_change }: SegmentedProps<Value>) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} onClick={() => on_change(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
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

// A search field that hands on what was typed once typing pauses.
export function SearchBox({ label, value, on_input }: SearchBoxProps) {
  const timer = useRef<number | undefined>(undefined);
  return (
    <input
      type="search"
      class="filter"
      placeholder={label}
      aria-label={label}
      value={value}
      onInput={(event) => {
        clearTimeout(timer.current);
        const text = (event.currentTarget as HTMLInputElement).value;
        timer.current = window.setTimeout(() => on_input(text), 200);
      }}
    />
  );
}
