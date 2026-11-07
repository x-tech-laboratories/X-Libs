// Modal dialogs on the native one: any body and buttons, one that asks before an action, and one that shows a long text.

import { Fragment, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "./toasts.tsx";

// ── Dialog ───────────────────────────────────────────────────────────────────

// Makes the body and buttons one form, so Enter in a field or a submit button runs on_submit.
export interface DialogForm {
  on_submit: (event: FormEvent<HTMLFormElement>) => void;
  // Adds the primary submit button after the other buttons.
  submit_label?: ReactNode;
  submit_disabled?: boolean;
  danger?: boolean;
}

interface DialogProps {
  title: ReactNode;
  // A muted line under the title, such as what the dialog edits.
  subtitle?: ReactNode;
  // Buttons on the title's row, such as a close or a menu button.
  actions?: ReactNode;
  on_close: () => void;
  // The row of buttons at the foot, such as Cancel and Save; inside a form, give the others type="button".
  buttons?: ReactNode;
  form?: DialogForm;
  wide?: boolean;
  // Fills the window, such as for a page shown over the app.
  full?: boolean;
  // A class that sets the dialog's own width or look.
  class_name?: string;
  children: ReactNode;
}

// Shown while it is rendered: the page behind it is inert, focus stays inside, Escape calls on_close, and focus goes back to the opener after.
export function Dialog({ title, subtitle, actions, on_close, buttons, form, wide = false, full = false, class_name, children }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title_id = useId();
  const close = useRef(on_close);
  close.current = on_close;

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      // The dialog is already gone from the page here, so the browser cannot hand focus back by itself.
      if (opener?.isConnected && opener !== document.body) opener.focus();
    };
  }, []);

  const heading = <h2 id={title_id}>{title}</h2>;
  const submit = form?.submit_label !== undefined && (
    <button type="submit" className={form.danger ? "danger solid" : "accent solid"} disabled={form.submit_disabled}>{form.submit_label}</button>
  );
  const foot = (buttons || submit) && <div className="dialog-buttons">{buttons}{submit}</div>;
  const body = <div className="dialog-body">{children}</div>;

  return (
    <dialog
      ref={dialog}
      className={["dialog", wide && "wide", full && "full", class_name].filter(Boolean).join(" ")}
      aria-labelledby={title_id}
      onCancel={(event) => {
        // Escape asks the owner to close, so the dialog never closes behind its owner's back.
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }}
    >
      {subtitle === undefined && actions === undefined ? heading : (
        <header className="dialog-header">
          <div className="dialog-heading">
            {heading}
            {subtitle !== undefined && <p className="dialog-subtitle">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="dialog-actions">{actions}</div>}
        </header>
      )}
      {form ? (
        <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); form.on_submit(event); }}>
          {body}
          {foot}
        </form>
      ) : <>{body}{foot}</>}
    </dialog>
  );
}

// ── Confirming ───────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirm_label: string;
  busy_label?: string;
  danger?: boolean;
  wide?: boolean;
  // Text the user must type before the confirm button wakes, for what cannot be undone.
  type_to_confirm?: string;
  // Runs while the dialog stays open with a busy label, closing it when done.
  run: () => Promise<void>;
}

export function ConfirmDialog({ options, on_close }: { options: ConfirmOptions; on_close: () => void }) {
  const [typed, set_typed] = useState("");
  const [busy, set_busy] = useState(false);
  const ready = options.type_to_confirm === undefined || typed === options.type_to_confirm;

  async function confirm(): Promise<void> {
    set_busy(true);
    try {
      await options.run();
    } finally {
      on_close();
    }
  }

  return (
    <Dialog
      title={options.title}
      on_close={() => { if (!busy) on_close(); }}
      wide={options.wide}
      buttons={<>
        <button disabled={busy} onClick={on_close}>Cancel</button>
        <button className={options.danger ? "danger solid" : "accent solid"} disabled={!ready || busy} onClick={confirm} autoFocus={options.type_to_confirm === undefined}>
          {busy ? options.busy_label ?? "Working…" : options.confirm_label}
        </button>
      </>}
    >
      {typeof options.message === "string" ? <p>{options.message}</p> : options.message}
      {options.type_to_confirm !== undefined && (
        <label className="type-confirm">
          <span>Type <strong>{options.type_to_confirm}</strong> to confirm:</span>
          <input type="text" className="filter" autoComplete="off" autoFocus aria-label={`Type ${options.type_to_confirm} to confirm`} value={typed} onChange={(event) => set_typed(event.currentTarget.value)} />
        </label>
      )}
    </Dialog>
  );
}

// Shows a long text result, such as a preview, with a button to copy it.
export function TextDialog({ title, text, on_close }: { title: string; text: string; on_close: () => void }) {
  return (
    <Dialog title={title} on_close={on_close} wide buttons={<>
      <button onClick={() => void navigator.clipboard?.writeText(text).then(() => toast("Copied."))}>Copy</button>
      <button className="accent solid" onClick={on_close}>Close</button>
    </>}>
      <pre className="output">{text}</pre>
    </Dialog>
  );
}

// ── Opening from anywhere ────────────────────────────────────────────────────

type Builder = (close: () => void) => ReactNode;

let open: { id: number; build: Builder }[] = [];
let next_id = 1;
const listeners = new Set<(dialogs: typeof open) => void>();

function publish(dialogs: typeof open): void {
  open = dialogs;
  for (const listener of listeners) listener(open);
}

// Opens what the builder makes, such as a Dialog, from an event handler; returns the function that closes it.
export function open_dialog(build: Builder): () => void {
  const id = next_id++;
  const close = () => publish(open.filter((dialog) => dialog.id !== id));
  publish([...open, { id, build }]);
  return close;
}

export function confirm_dialog(options: ConfirmOptions): void {
  open_dialog((close) => <ConfirmDialog options={options} on_close={close} />);
}

export function text_dialog(title: string, text: string): void {
  open_dialog((close) => <TextDialog title={title} text={text} on_close={close} />);
}

// Where dialogs opened from anywhere are drawn; the Shell holds one.
export function Dialogs() {
  const [dialogs, set_dialogs] = useState(open);
  useEffect(() => {
    listeners.add(set_dialogs);
    return () => void listeners.delete(set_dialogs);
  }, []);
  return <>{dialogs.map((dialog) => <Fragment key={dialog.id}>{dialog.build(() => publish(open.filter((other) => other.id !== dialog.id)))}</Fragment>)}</>;
}
