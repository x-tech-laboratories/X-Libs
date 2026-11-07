// A change counter a store bumps and a page watches, so only what reads the store redraws when it changes.

export interface Watch {
  version(): number;
  bump(): void;
  // Returns the function that stops listening.
  subscribe(listener: () => void): () => void;
}

export function create_watch(): Watch {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    version: () => version,
    bump: () => {
      version += 1;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
