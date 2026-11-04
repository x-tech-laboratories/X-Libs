// A Preact modal dialog on the native one: the page behind it is inert, focus stays inside, and Escape closes it.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";

// ── Dialog ───────────────────────────────────────────────────────────────────

interface DialogProps {
  title: ComponentChildren;
  on_close: () => void;
  // The row of buttons at the foot, such as Cancel and Save.
  buttons?: ComponentChildren;
  wide?: boolean;
  // A class that sets the dialog's own width or look.
  class_name?: string;
  children: ComponentChildren;
}

// Shown while it is rendered; closing it by Escape or a button calls on_close, which should stop rendering it.
export function Dialog({ title, on_close, buttons, wide = false, class_name, children }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title_id = useId();
  const close = useRef(on_close);
  close.current = on_close;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      class={["dialog", wide && "wide", class_name].filter(Boolean).join(" ")}
      aria-labelledby={title_id}
      onCancel={(event) => {
        // Escape asks the owner to close, so the dialog never closes behind its owner's back.
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }}
    >
      <h2 id={title_id}>{title}</h2>
      <div class="dialog-body">{children}</div>
      {buttons && <div class="dialog-buttons">{buttons}</div>}
    </dialog>
  );
}
