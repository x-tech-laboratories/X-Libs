// The app's place on the desktop: one copy running at a time, its window brought forward, and links handed over on the command line.

// ── Electron's shapes ────────────────────────────────────────────────────────

// Only the parts of Electron's app these helpers use, so this module builds without Electron installed.
export interface AppLike {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: "second-instance", listener: (event: unknown, argv: string[]) => void): unknown;
}

export interface FocusableWindowLike {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

// ── One copy ─────────────────────────────────────────────────────────────────

// Keeps one copy running: a second launch hands its command line to the first and quits; returns false in the copy that must quit.
export function hold_single_instance(app: AppLike, on_second_launch: (argv: string[]) => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, argv) => on_second_launch(argv));
  return true;
}

// Brings a window forward, restoring it first when minimised.
export function bring_to_front(window: FocusableWindowLike): void {
  if (window.isMinimized()) window.restore();
  window.focus();
}

// ── Command line ─────────────────────────────────────────────────────────────

// The first command-line argument a parser accepts, such as a task link, or null.
export function first_argument<Value>(argv: readonly string[], parse: (argument: string) => Value | null): Value | null {
  for (const argument of argv) {
    const value = parse(argument);
    if (value !== null) return value;
  }
  return null;
}
