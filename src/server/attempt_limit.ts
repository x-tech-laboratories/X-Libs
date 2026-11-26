// Counting tries per key, such as an address or a user, in a fixed window: a key that has used up its tries waits until
// its window ends, and a try that succeeded can be given back so only failures and tries still running count.

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface AttemptLimitOptions {
  // How many tries one key gets in a window.
  tries_allowed: number;
  // How long a window lasts, in seconds.
  window_seconds: number;
  // How many keys are remembered at once, the oldest window forgotten first; 10000 unless set.
  most_keys?: number;
  // The time in milliseconds; the clock unless set.
  now?: () => number;
}

interface Window {
  count: number;
  ends_at: number;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const default_most_keys = 10_000;

// Four times one name's tries, so a household or office behind one address can all mistype, while names given in turn still wait.
export const default_address_tries_allowed = 20;
export const default_address_try_window_seconds = 5 * 60;

// What a refused try is told, the same whichever limit refused it, so it says nothing about the name.
export const too_many_tries_text = "Too many tries; wait a few minutes.";

// ── Limit ────────────────────────────────────────────────────────────────────

export class AttemptLimit {
  private readonly windows = new Map<string, Window>();
  private readonly tries_allowed: number;
  private readonly window_milliseconds: number;
  private readonly most_keys: number;
  private readonly now: () => number;

  constructor(options: AttemptLimitOptions) {
    this.tries_allowed = options.tries_allowed;
    this.window_milliseconds = options.window_seconds * 1000;
    this.most_keys = options.most_keys ?? default_most_keys;
    this.now = options.now ?? Date.now;
  }

  // Counts a try for the key and answers 0 when it may go ahead, or the whole seconds it must wait when it may not.
  take(key: string): number {
    const now = this.now();
    let window = this.windows.get(key);
    if (window === undefined || window.ends_at <= now) {
      this.windows.delete(key);
      this.forget_oldest();
      window = { count: 0, ends_at: now + this.window_milliseconds };
      this.windows.set(key, window);
    }
    if (window.count >= this.tries_allowed) return Math.max(1, Math.ceil((window.ends_at - now) / 1000));
    window.count += 1;
    return 0;
  }

  // Gives back a try that succeeded, so it does not count against the key.
  give_back(key: string): void {
    const window = this.windows.get(key);
    if (window !== undefined && window.count > 0) window.count -= 1;
  }

  // Drops ended windows, then the oldest ones, until there is room for one more key.
  private forget_oldest(): void {
    if (this.windows.size < this.most_keys) return;
    const now = this.now();
    for (const [key, window] of this.windows) if (window.ends_at <= now) this.windows.delete(key);
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.most_keys) break;
      this.windows.delete(key);
    }
  }
}
