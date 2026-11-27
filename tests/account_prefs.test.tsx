// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { create_accounts_client, type AccountPref } from "../src/web/accounts.ts";
import { ApiError } from "../src/web/api.ts";
import { one_of } from "../src/web/prefs.ts";
import { use_account_pref, type AccountPrefOptions, type AccountPrefsClient } from "../src/web/react/account_prefs.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Write {
  key: string;
  value: unknown;
  keepalive: boolean;
}

// A server held in memory, whose reads and writes can be made to fail.
function fake_client(stored: Record<string, unknown> = {}) {
  const writes: Write[] = [];
  const control = { fail_read: null as Error | null, fail_write: null as Error | null };
  const client: AccountPrefsClient = {
    pref: async <Value,>(key: string) => {
      if (control.fail_read) throw control.fail_read;
      return (Object.hasOwn(stored, key) ? { key, value: stored[key], changed_epoch: 1 } : { key, value: null, changed_epoch: null }) as AccountPref<Value>;
    },
    set_pref: async <Value,>(key: string, value: Value, call: { keepalive?: boolean } = {}) => {
      writes.push({ key, value, keepalive: call.keepalive === true });
      if (control.fail_write) throw control.fail_write;
      stored[key] = value;
      return { key, value, changed_epoch: 2 };
    },
  };
  return { client, writes, control, stored };
}

type ThemeName = "light" | "dark" | "sepia";

let change: (next: ThemeName) => void = () => {};

function Theme({ client, pref_key = "theme", options }: { client: AccountPrefsClient; pref_key?: string; options?: AccountPrefOptions }) {
  const [theme, set_theme, state] = use_account_pref<ThemeName>(client, pref_key, "light", one_of("light", "dark", "sepia"), options);
  change = set_theme;
  return (
    <section aria-label="Theme">
      <p>{theme}</p>
      <p>{state.status}</p>
      {state.saving && <p>Saving</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.save_error && <p role="status">{state.save_error}</p>}
    </section>
  );
}

// Lets the fake client's promises settle.
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

// ============================================================================
// Reading
// ============================================================================

describe("use_account_pref reading", () => {
  it("shows the initial value while loading, then the stored one", async () => {
    const { client } = fake_client({ theme: "dark" });
    render(<Theme client={client} />);
    expect(screen.getByText("light")).toBeTruthy();
    expect(screen.getByText("loading")).toBeTruthy();

    await settle();

    expect(screen.getByText("dark")).toBeTruthy();
    expect(screen.getByText("loaded")).toBeTruthy();
  });

  it("keeps the initial value when none is stored or the stored one fails the validator", async () => {
    const { client } = fake_client({ odd: "neon" });
    render(<Theme client={client} pref_key="odd" />);
    await settle();

    expect(screen.getByText("light")).toBeTruthy();
    expect(screen.getByText("loaded")).toBeTruthy();
  });

  it("reports a read that fails", async () => {
    const { client, control } = fake_client();
    control.fail_read = new ApiError("The server did not answer: offline", null);
    render(<Theme client={client} />);
    await settle();

    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("The server did not answer: offline");
  });

  it("keeps a change made while it was loading", async () => {
    const { client } = fake_client({ theme: "dark" });
    render(<Theme client={client} />);

    act(() => change("sepia"));
    await settle();

    expect(screen.getByText("sepia")).toBeTruthy();
  });
});

// ============================================================================
// Saving
// ============================================================================

describe("use_account_pref saving", () => {
  it("shows a change at once and saves a burst of them as one write of the last", async () => {
    const { client, writes } = fake_client();
    render(<Theme client={client} />);
    await settle();

    act(() => change("dark"));
    act(() => change("sepia"));
    expect(screen.getByText("sepia")).toBeTruthy();
    expect(screen.getByText("Saving")).toBeTruthy();
    expect(writes).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(writes).toEqual([{ key: "theme", value: "sepia", keepalive: false }]);
    expect(screen.queryByText("Saving")).toBeNull();
  });

  it("waits the delay the app sets", async () => {
    const { client, writes } = fake_client();
    render(<Theme client={client} options={{ save_delay_in_milliseconds: 5000 }} />);
    await settle();

    act(() => change("dark"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(writes).toHaveLength(1);
  });

  it("reports a failed save in its state and to the app, and clears it once one succeeds", async () => {
    const { client, control } = fake_client();
    const failures: string[] = [];
    render(<Theme client={client} options={{ on_save_error: (message) => failures.push(message) }} />);
    await settle();
    control.fail_write = new ApiError("This token can only read.", 403);

    act(() => change("dark"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByRole("status").textContent).toBe("This token can only read.");
    expect(failures).toEqual(["This token can only read."]);

    control.fail_write = null;
    act(() => change("sepia"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends a waiting change at once, outliving the page, when the page is hidden", async () => {
    const { client, writes } = fake_client();
    render(<Theme client={client} />);
    await settle();

    act(() => change("dark"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();

    expect(writes).toEqual([{ key: "theme", value: "dark", keepalive: true }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(1);
  });

  it("sends a waiting change when the tab is hidden or the component goes away", async () => {
    const { client, writes } = fake_client();
    const { unmount } = render(<Theme client={client} />);
    await settle();

    act(() => change("dark"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => change("sepia"));
    unmount();
    await settle();

    expect(writes.map((write) => write.value)).toEqual(["dark", "sepia"]);
  });

  it("writes one change at a time, so the last value is the one kept", async () => {
    const { client, stored } = fake_client();
    let finish_first: () => void = () => {};
    const slow: AccountPrefsClient = {
      pref: client.pref,
      set_pref: async (key, value, call) => {
        if (value === "dark") await new Promise<void>((resolve) => { finish_first = resolve; });
        return client.set_pref(key, value, call);
      },
    };
    render(<Theme client={slow} />);
    await settle();

    act(() => change("dark"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => change("sepia"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    finish_first();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(stored.theme).toBe("sepia");
  });
});

// ============================================================================
// Client
// ============================================================================

describe("the accounts client's preference calls", () => {
  it("read and write under the base, sending the value as { value }", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const fetch_function = (async (path: string, init: RequestInit) => {
      seen.push({ path, init });
      return new Response(JSON.stringify({ key: "my dashboards", value: [], changed_epoch: 3 }), { status: 200 });
    }) as typeof fetch;
    const client = create_accounts_client({ base: "https://nix.example/api/", fetch: fetch_function, headers: () => ({ authorization: "Bearer xt_test" }) });

    expect(await client.pref("my dashboards")).toEqual({ key: "my dashboards", value: [], changed_epoch: 3 });
    await client.set_pref("my dashboards", [{ id: 1 }], { keepalive: true });

    expect(seen.map((request) => [request.path, request.init.method])).toEqual([
      ["https://nix.example/api/account/prefs/my%20dashboards", "GET"],
      ["https://nix.example/api/account/prefs/my%20dashboards", "PUT"],
    ]);
    expect(seen[1]!.init.body).toBe('{"value":[{"id":1}]}');
    expect(seen[1]!.init.keepalive).toBe(true);
    expect((seen[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer xt_test");
  });
});
