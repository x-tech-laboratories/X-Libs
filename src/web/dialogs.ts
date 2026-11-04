// Modal dialogs: one with any body and buttons, one that asks before an action, and one that shows a long text.

import { h, type Child } from "./dom.ts";
import { toast } from "./toasts.ts";

// ── Dialogs ──────────────────────────────────────────────────────────────────

export interface DialogOptions {
  wide?: boolean;
  // A class that sets the dialog's own width or look.
  class_name?: string;
}

// A modal dialog: the page behind it is inert, focus stays inside, and Escape closes it.
export function open_dialog(title: string, body: Child, buttons: (close: () => void) => Child, options: DialogOptions = {}): () => void {
  const classes = ["dialog", options.wide && "wide", options.class_name].filter(Boolean).join(" ");
  const dialog = h("dialog", { class: classes, "aria-labelledby": "dialog-title" });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(
    h("h2", { id: "dialog-title" }, title),
    h("div", { class: "dialog-body" }, body),
    h("div", { class: "dialog-buttons" }, buttons(close)),
  );
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

// ── Confirming ───────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message: Child;
  confirm_label: string;
  busy_label?: string;
  danger?: boolean;
  wide?: boolean;
  // Text the user must type before the confirm button wakes, for what cannot be undone.
  type_to_confirm?: string;
  // Runs while the dialog stays open with a busy label, closing it when done.
  run: () => Promise<void>;
}

export function confirm_dialog(options: ConfirmOptions): void {
  const confirm = h("button", { class: options.danger ? "danger solid" : "accent solid", disabled: options.type_to_confirm !== undefined }, options.confirm_label);
  const typed = options.type_to_confirm === undefined ? null : h("input", {
    type: "text", class: "filter", autocomplete: "off", "aria-label": `Type ${options.type_to_confirm} to confirm`,
    oninput: (event: Event) => { confirm.disabled = (event.target as HTMLInputElement).value !== options.type_to_confirm; },
  });
  const body = h("div", {},
    typeof options.message === "string" ? h("p", {}, options.message) : options.message,
    typed && h("label", { class: "type-confirm" }, h("span", {}, "Type ", h("strong", {}, options.type_to_confirm!), " to confirm:"), typed),
  );
  open_dialog(options.title, body, (close) => {
    const cancel = h("button", { onclick: close }, "Cancel");
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.textContent = options.busy_label ?? "Working…";
      try {
        await options.run();
      } finally {
        close();
      }
    });
    return [cancel, confirm];
  }, { wide: options.wide });
  (typed ?? confirm).focus();
}

// ── Text ─────────────────────────────────────────────────────────────────────

// Shows a long text result, such as a preview, with a button to copy it.
export function text_dialog(title: string, text: string): void {
  open_dialog(title, h("pre", { class: "output" }, text), (close) => [
    h("button", { onclick: () => void navigator.clipboard?.writeText(text).then(() => toast("Copied.")) }, "Copy"),
    h("button", { class: "accent solid", onclick: close }, "Close"),
  ], { wide: true });
}
