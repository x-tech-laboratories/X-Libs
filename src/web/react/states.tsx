// What a part of the page shows while it loads, when it has nothing, and when loading failed, and the hook that loads it.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { pass_login_needed } from "../states.ts";

// ── States ───────────────────────────────────────────────────────────────────

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => <div key={index} className="skeleton-line" style={{ width: `${90 - index * 15}%` }} />)}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}

export function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="failure" role="alert">
      <p>Could not load this: {error instanceof Error ? error.message : String(error)}</p>
      <button onClick={retry}>Retry</button>
    </div>
  );
}

// ── Loading ──────────────────────────────────────────────────────────────────

export interface Resource<Data> {
  data: Data | null;
  error: unknown;
  loading: boolean;
  // Loads again, settling once the load has; a quiet reload keeps what is shown, even when it fails.
  reload: (quiet?: boolean) => Promise<void>;
}

export interface ResourceOptions {
  // How often an open page loads again quietly while it is in view, so a running job's progress shows.
  refresh_in_milliseconds?: number;
}

// Loads what the work fetches whenever the dependencies change, passing a lapsed login on to the page.
export function use_resource<Data>(work: () => Promise<Data>, dependencies: unknown[], options: ResourceOptions = {}): Resource<Data> {
  const [state, set_state] = useState<{ data: Data | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const latest_work = useRef(work);
  latest_work.current = work;
  const generation = useRef(0);

  const reload = useCallback((quiet = false): Promise<void> => {
    const mine = ++generation.current;
    if (!quiet) set_state({ data: null, error: null, loading: true });
    return latest_work.current().then(
      (data) => { if (mine === generation.current) set_state({ data, error: null, loading: false }); },
      (error) => {
        if (pass_login_needed(error) || mine !== generation.current) return;
        set_state((before) => quiet && before.data !== null ? { ...before, loading: false } : { data: null, error, loading: false });
      },
    );
  }, []);

  useEffect(() => void reload(), dependencies);

  useEffect(() => {
    if (!options.refresh_in_milliseconds) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(true); }, options.refresh_in_milliseconds);
    return () => clearInterval(timer);
  }, [options.refresh_in_milliseconds]);

  return { ...state, reload };
}

// Shows a skeleton while the resource first loads, an error with Retry if that fails, and what children build from it after.
export function Loaded<Data>({ resource, lines, children }: { resource: Resource<Data>; lines?: number; children: (data: Data) => ReactNode }) {
  if (resource.data !== null) return <>{children(resource.data)}</>;
  if (resource.error !== null) return <Failure error={resource.error} retry={() => void resource.reload()} />;
  return <Skeleton lines={lines} />;
}
