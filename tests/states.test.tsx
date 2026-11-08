// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { Loaded, use_resource, type Resource } from "../src/web/react/states.tsx";
import { create_watch } from "../src/web/watch.ts";

afterEach(cleanup);

// Draws the resource's status and lets the test read the resource itself.
function Probe({ work, enabled, watch, seen }: { work: () => Promise<string>; enabled?: boolean; watch?: ReturnType<typeof create_watch>; seen: (resource: Resource<string>) => void }) {
  const resource = use_resource(work, [], { enabled, watch });
  seen(resource);
  return <Loaded resource={resource} idle={<p>Type to search</p>}>{(data) => <p>{data}</p>}</Loaded>;
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

describe("use_resource", () => {
  test("starts loading and ends loaded, as before", async () => {
    let latest: Resource<string> | undefined;
    render(<Probe work={() => Promise.resolve("milk")} seen={(resource) => { latest = resource; }} />);

    expect(latest).toMatchObject({ status: "loading", loading: true, data: null });
    await settle();
    expect(latest).toMatchObject({ status: "loaded", loading: false, data: "milk" });
    expect(screen.getByText("milk")).toBeTruthy();
  });

  test("stays idle until enabled, showing the idle slot, and goes back to idle when turned off", async () => {
    const work = vi.fn(() => Promise.resolve("found"));
    let latest: Resource<string> | undefined;
    const { rerender } = render(<Probe work={work} enabled={false} seen={(resource) => { latest = resource; }} />);

    await settle();
    expect(latest).toMatchObject({ status: "idle", loading: false, data: null, error: null });
    expect(screen.getByText("Type to search")).toBeTruthy();
    expect(work).not.toHaveBeenCalled();

    rerender(<Probe work={work} enabled seen={(resource) => { latest = resource; }} />);
    expect(latest?.status).toBe("loading");
    await settle();
    expect(latest).toMatchObject({ status: "loaded", data: "found" });

    rerender(<Probe work={work} enabled={false} seen={(resource) => { latest = resource; }} />);
    expect(latest).toMatchObject({ status: "idle", data: null });
    expect(work).toHaveBeenCalledTimes(1);
  });

  test("fails loudly on a first failure and keeps its data through a quiet one", async () => {
    let answer: Promise<string> = Promise.reject(new Error("down"));
    let latest: Resource<string> | undefined;
    render(<Probe work={() => answer} seen={(resource) => { latest = resource; }} />);

    await settle();
    expect(latest).toMatchObject({ status: "failed", loading: false });
    expect(screen.getByRole("alert").textContent).toContain("down");

    answer = Promise.resolve("up");
    await act(() => latest!.reload());
    answer = Promise.reject(new Error("down again"));
    await act(() => latest!.reload(true));
    expect(latest).toMatchObject({ status: "loaded", data: "up" });
  });

  test("loads again quietly when its watch is bumped", async () => {
    const watch = create_watch();
    let count = 0;
    let latest: Resource<string> | undefined;
    render(<Probe work={() => Promise.resolve(`load ${++count}`)} watch={watch} seen={(resource) => { latest = resource; }} />);

    await settle();
    expect(latest?.data).toBe("load 1");
    act(() => watch.bump());
    expect(latest?.status).toBe("loaded");
    await settle();
    expect(latest?.data).toBe("load 2");
  });
});
