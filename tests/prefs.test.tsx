// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { use_pref } from "../src/web/react/prefs.ts";
import { browser_storage, is_boolean, is_number_in, one_of, read_pref, write_pref, type StorageLike } from "../src/web/prefs.ts";

afterEach(cleanup);

function fake_storage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key) };
}

// ============================================================================
// Reading
// ============================================================================

describe("read_pref", () => {
  it("returns the default when nothing is stored, and a valid stored value", () => {
    expect(read_pref(fake_storage(), "key", true)).toBe(true);
    expect(read_pref(fake_storage({ key: "false" }), "key", true, is_boolean)).toBe(false);
  });

  it("falls back when the stored value is not JSON or fails its validator", () => {
    expect(read_pref(fake_storage({ key: "not json{" }), "key", 7)).toBe(7);
    expect(read_pref(fake_storage({ key: "\"huge\"" }), "key", "normal", one_of("compact", "normal", "comfortable"))).toBe("normal");
  });

  it("falls back when the stored shape no longer matches the default", () => {
    expect(read_pref(fake_storage({ key: "\"yes\"" }), "key", false)).toBe(false);
    expect(read_pref(fake_storage({ key: "{\"a\":1}" }), "key", [1, 2])).toEqual([1, 2]);
  });

  it("accepts a number inside a range and rejects one outside it", () => {
    expect(read_pref(fake_storage({ key: "5" }), "key", 3, is_number_in(0, 60))).toBe(5);
    expect(read_pref(fake_storage({ key: "999" }), "key", 3, is_number_in(0, 60))).toBe(3);
  });

  it("survives storage that refuses every call, or none at all", () => {
    const hostile: StorageLike = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    };
    expect(read_pref(hostile, "key", "fallback")).toBe("fallback");
    expect(() => write_pref(hostile, "key", "x")).not.toThrow();
    expect(read_pref(undefined, "key", "fallback")).toBe("fallback");
  });

  it("round-trips objects and finds this browser's storage", () => {
    const storage = fake_storage();
    write_pref(storage, "reasons", { audio_hash: true, fuzzy: false });
    expect(read_pref(storage, "reasons", {})).toEqual({ audio_hash: true, fuzzy: false });
    expect(browser_storage()).toBe(localStorage);
  });
});

// ============================================================================
// Hook
// ============================================================================

describe("use_pref", () => {
  it("starts from the stored value and writes every change", () => {
    const storage = fake_storage({ density: "\"compact\"" });
    let change: (next: "compact" | "normal") => void = () => {};
    function Density() {
      const [density, set_density] = use_pref("density", "normal", one_of("compact", "normal"), storage);
      change = set_density;
      return <p>{density}</p>;
    }
    render(<Density />);
    expect(screen.getByText("compact")).toBeTruthy();

    act(() => change("normal"));

    expect(screen.getByText("normal")).toBeTruthy();
    expect(storage.map.get("density")).toBe("\"normal\"");
  });
});
