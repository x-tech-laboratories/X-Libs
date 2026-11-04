// Controls that change what a view shows or does: filters, selects, segmented choices, switches and button groups.

import { h, type Child } from "./dom.ts";

// ── Filters ──────────────────────────────────────────────────────────────────

// A search field that hands on what was typed once typing pauses.
export function search_box(label: string, value: string, on_input: (value: string) => void): HTMLInputElement {
  let timer: number | undefined;
  return h("input", {
    type: "search", class: "filter", placeholder: label, "aria-label": label, value,
    oninput: (event: Event) => {
      clearTimeout(timer);
      const text = (event.target as HTMLInputElement).value;
      timer = window.setTimeout(() => on_input(text), 200);
    },
  });
}

export function select(label: string, options: [value: string, text: string][], value: string, on_change: (value: string) => void): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label),
    h("select", { onchange: (event: Event) => on_change((event.target as HTMLSelectElement).value) },
      ...options.map(([option, text]) => h("option", { value: option, selected: option === value }, text))));
}

// ── Choices ──────────────────────────────────────────────────────────────────

// One of a few choices side by side, such as cards or a table; the chosen one takes the accent.
export function segmented<Value extends string>(label: string, choices: [value: Value, text: string][], value: Value, on_change: (value: Value) => void): HTMLElement {
  const buttons = choices.map(([choice, text]) => h("button", {
    type: "button", role: "radio", "aria-checked": String(choice === value),
    onclick: () => {
      for (const [index, button] of buttons.entries()) button.setAttribute("aria-checked", String(choices[index]![0] === choice));
      on_change(choice);
    },
  }, text));
  return h("div", { class: "segmented", role: "radiogroup", "aria-label": label }, ...buttons);
}

// Buttons joined into one control, such as zoom out, zoom in and fit.
export function button_group(label: string, ...buttons: Child[]): HTMLElement {
  return h("div", { class: "segmented", role: "group", "aria-label": label }, ...buttons);
}

// An on and off switch that waits on the change and flips back when the change did not take.
export function switch_toggle(label: string, checked: boolean, on_change: (on: boolean) => Promise<boolean | void> | boolean | void): HTMLInputElement {
  const box = h("input", { type: "checkbox", role: "switch", checked, "aria-label": label });
  box.addEventListener("change", async () => {
    const on = box.checked;
    box.disabled = true;
    try {
      if ((await on_change(on)) === false) box.checked = !on;
    } catch (error) {
      box.checked = !on;
      throw error;
    } finally {
      box.disabled = false;
    }
  });
  return box;
}
