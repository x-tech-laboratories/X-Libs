// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { use_watch } from "../src/web/react/watch.ts";
import { create_watch, type Watch } from "../src/web/watch.ts";

afterEach(cleanup);

// ============================================================================
// Watches
// ============================================================================

describe("watch", () => {
  it("counts bumps and tells each listener until it stops listening", () => {
    const watch = create_watch();
    const listener = vi.fn();
    const stop = watch.subscribe(listener);

    watch.bump();
    stop();
    watch.bump();

    expect(watch.version()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("redraws a component that watches it on every bump", () => {
    const watch = create_watch();
    let count = 0;
    function Counter({ watched }: { watched: Watch }) {
      use_watch(watched);
      count += 1;
      return <p>{`drawn ${watched.version()}`}</p>;
    }
    render(<Counter watched={watch} />);

    act(() => watch.bump());

    expect(screen.getByText("drawn 1")).toBeTruthy();
    expect(count).toBe(2);
  });
});
