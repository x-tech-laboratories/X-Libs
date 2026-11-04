// What a part of the page shows while it loads, when it has nothing, and when loading failed.

import { h, nodes, type Child } from "./dom.ts";

// ── Login ────────────────────────────────────────────────────────────────────

// Thrown by a request whose session has lapsed; loading passes it on so the page can ask for a login.
export class LoginNeeded extends Error {}

// ── States ───────────────────────────────────────────────────────────────────

export function skeleton(lines = 3): HTMLElement {
  return h("div", { class: "skeleton", "aria-busy": "true", "aria-label": "Loading" },
    ...Array.from({ length: lines }, (_, index) => h("div", { class: "skeleton-line", style: `width: ${90 - index * 15}%` })));
}

export function empty(title: string, hint: Child = null): HTMLElement {
  return h("div", { class: "empty" }, h("p", { class: "empty-title" }, title), hint && h("p", { class: "muted" }, hint));
}

export function failure(error: unknown, retry: () => void): HTMLElement {
  return h("div", { class: "failure", role: "alert" },
    h("p", {}, `Could not load this: ${error instanceof Error ? error.message : String(error)}`),
    h("button", { onclick: retry }, "Retry"));
}

// ── Loading ──────────────────────────────────────────────────────────────────

// Fills the target with what the work builds, showing a skeleton first and an error with Retry if it fails.
export async function load(target: HTMLElement, work: () => Promise<Child>, options: { quiet?: boolean } = {}): Promise<boolean> {
  if (!options.quiet) target.replaceChildren(skeleton());
  try {
    target.replaceChildren(...nodes(await work()));
    return true;
  } catch (error) {
    // A login is the page's to ask for; a quiet refresh keeps what is already shown.
    if (error instanceof LoginNeeded) throw error;
    if (!options.quiet) target.replaceChildren(failure(error, () => void load(target, work)));
    return false;
  }
}

// Fetches what a view needs, putting an error with Retry in the target when a first load fails; null when it failed.
export async function attempt<Answer>(target: HTMLElement, quiet: boolean, work: () => Promise<Answer>, retry: () => void): Promise<Answer | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LoginNeeded) throw error;
    if (!quiet) target.replaceChildren(failure(error, retry));
    return null;
  }
}
