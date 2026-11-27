// One of the signed-in user's preferences kept on the server as component state, so it follows them between devices:
// read when the component mounts, shown at once on every change and saved shortly after, a burst of changes such as a
// drag going as one write of the last value. A failed read or save shows in the state and goes to `on_save_error`, and
// a change still waiting is sent as the page is hidden or closed, or the component goes away.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

import type { AccountsClient } from "../accounts.ts";
import { describe_error } from "../errors.ts";
import { checked_pref, type Validator } from "../prefs.ts";
import { LoginNeeded } from "../states.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// The client's two preference calls, which `create_accounts_client` gives.
export type AccountPrefsClient = Pick<AccountsClient, "pref" | "set_pref">;

export interface AccountPrefState {
  // Loading until the server first answers, then loaded, or failed when it could not be read.
  status: "loading" | "loaded" | "failed";
  // Why it could not be read, or null.
  error: string | null;
  // Whether a change waits to be saved or is being saved.
  saving: boolean;
  // Why the last save failed, or null once one succeeds.
  save_error: string | null;
}

export interface AccountPrefOptions {
  // How long after the last change it is saved; `default_save_delay_in_milliseconds` unless set.
  save_delay_in_milliseconds?: number;
  // Hears every failed save, even one sent after the component went away, such as to show a toast.
  on_save_error?: (message: string) => void;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const default_save_delay_in_milliseconds = 600;

// ── Hook ─────────────────────────────────────────────────────────────────────

interface PendingChange {
  client: AccountPrefsClient;
  key: string;
  value: unknown;
}

// Keep the client the same between renders, such as one made once for the page, or every render reads it again.
export function use_account_pref<Value>(
  client: AccountPrefsClient, key: string, initial: Value, validate?: Validator<Value>, options: AccountPrefOptions = {},
): [Value, (next: Value) => void, AccountPrefState] {
  const [value, set_value] = useState(initial);
  const [state, set_state] = useState<AccountPrefState>({ status: "loading", error: null, saving: false, save_error: null });
  const pending = useRef<PendingChange | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writing = useRef(false);
  const changed_here = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ initial, validate, options });
  latest.current = { initial, validate, options };

  const report = (message: string): void => {
    if (mounted.current) set_state((current) => ({ ...current, save_error: message }));
    latest.current.options.on_save_error?.(message);
  };

  // Sends one change, telling whoever listens when it fails.
  const send = async (change: PendingChange, keepalive: boolean): Promise<void> => {
    try {
      await change.client.set_pref(change.key, change.value, { keepalive });
      if (mounted.current) set_state((current) => ({ ...current, save_error: null }));
    } catch (error) {
      report(describe_error(error));
      if (error instanceof LoginNeeded) throw error;
    }
  };

  // Sends the waiting change, one write at a time so the last value is the one kept.
  const save = async (): Promise<void> => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (writing.current) return;
    writing.current = true;
    try {
      while (pending.current !== null) {
        const change = pending.current;
        pending.current = null;
        await send(change, false);
      }
    } finally {
      writing.current = false;
      if (mounted.current) set_state((current) => ({ ...current, saving: pending.current !== null }));
    }
  };

  // Sends the waiting change at once as one that outlives the page, without waiting for a write already going.
  const save_now = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const change = pending.current;
    if (change === null) return;
    pending.current = null;
    void send(change, true);
  };

  useEffect(() => {
    let current = true;
    changed_here.current = false;
    set_value(latest.current.initial);
    set_state((state_now) => ({ ...state_now, status: "loading", error: null }));
    client.pref(key).then((answer) => {
      if (!current) return;
      const { initial: start, validate: check } = latest.current;
      if (!changed_here.current) set_value(answer.changed_epoch === null ? start : checked_pref(answer.value, start, check));
      set_state((state_now) => ({ ...state_now, status: "loaded", error: null }));
    }).catch((error: unknown) => {
      if (!current) return;
      set_state((state_now) => ({ ...state_now, status: "failed", error: describe_error(error) }));
      if (error instanceof LoginNeeded) throw error;
    });
    return () => {
      current = false;
      save_now();
    };
  }, [client, key]);

  useEffect(() => {
    mounted.current = true;
    const on_visibility = (): void => {
      if (document.visibilityState === "hidden") save_now();
    };
    window.addEventListener("pagehide", save_now);
    document.addEventListener("visibilitychange", on_visibility);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", save_now);
      document.removeEventListener("visibilitychange", on_visibility);
    };
  }, []);

  const change = (next: Value): void => {
    changed_here.current = true;
    set_value(next);
    pending.current = { client, key, value: next };
    set_state((current) => ({ ...current, saving: true }));
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), latest.current.options.save_delay_in_milliseconds ?? default_save_delay_in_milliseconds);
  };

  return [value, change, state];
}
