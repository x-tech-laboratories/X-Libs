// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create_plugin_host, type Plugin } from "../src/plugins.ts";
import { plugin_menu_items, PluginSettings, PluginSlot } from "../src/web/react/plugins.tsx";

interface Api {
  slots: { sidebar: ComponentType<{ title: string }> };
}

const app = { id: "x-tasks", version: "1.0.0" };

function plugin(id: string, extra: Partial<Plugin<Api>> = {}): Plugin<Api> {
  return { id, name: `Plugin ${id}`, version: "1.0.0", start: () => {}, ...extra };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PluginSlot", () => {
  it("draws what running plugins put in the slot, and leaves out one that fails to draw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const on_error = vi.fn();
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("good", { start: (context) => context.fill_slot("sidebar", ({ title }) => <p>Good for {title}</p>) }));
    await host.add(plugin("bad", { start: (context) => context.fill_slot("sidebar", () => { throw new Error("broken"); }) }));
    await host.start();

    render(<PluginSlot host={host} name="sidebar" props={{ title: "today" }} on_error={on_error} />);
    expect(screen.getByText("Good for today")).toBeTruthy();
    expect(on_error).toHaveBeenCalledWith("bad", expect.any(Error));

    await act(() => host.disable("good"));
    expect(screen.queryByText("Good for today")).toBeNull();
  });

  it("draws the empty slot's stand-in when nothing fills it", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.start();
    render(<PluginSlot host={host} name="sidebar" props={{ title: "x" }} empty={<p>Nothing here</p>} />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});

describe("PluginSettings", () => {
  it("turns a plugin off and on and edits its settings", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("a", {
      description: "Does things",
      settings: [
        { key: "loud", label: "Loud", type: "switch", default: false },
        { key: "name", label: "Name", type: "text", default: "x" },
      ],
    }));
    await host.start();
    render(<PluginSettings host={host} />);

    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    expect(screen.getByText("Does things")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByLabelText("Turn Plugin a on")); });
    expect(host.list()[0]?.state).toBe("off");
    expect(screen.getByText("Off")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByLabelText("Loud")); });
    const name = screen.getByDisplayValue("x");
    fireEvent.change(name, { target: { value: "y" } });
    await act(async () => { fireEvent.blur(name); });
    expect(host.settings("a")).toEqual({ loud: true, name: "y" });
  });

  it("leaves its heading to the settings section around it when given null", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("a", { description: "Does things" }));
    await host.start();
    render(<PluginSettings host={host} heading={null} />);

    expect(screen.queryByRole("heading", { name: "Plugins" })).toBeNull();
    expect(screen.getByText("Does things")).toBeTruthy();
  });

  it("shows why a plugin cannot run", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("needy", { requires: { ghost: "*" } }));
    await host.start();
    render(<PluginSettings host={host} />);

    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("It needs ghost *, which is not installed.")).toBeTruthy();
  });
});

describe("PluginSettings with nothing installed", () => {
  it("still shows the Plugins section, saying so", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.start();
    render(<PluginSettings host={host} heading="Extensions" />);

    expect(screen.getByRole("heading", { name: "Extensions" })).toBeTruthy();
    expect(screen.getByText("No plugins are installed.")).toBeTruthy();
  });
});

describe("plugin_menu_items", () => {
  it("lists the commands with their keys as the hint", async () => {
    const run = vi.fn();
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("a", { start: (context) => context.add_command({ id: "go", label: "Go", keys: "ctrl+g", run }) }));
    await host.start();

    const [item] = plugin_menu_items(host);
    expect([item?.label, item?.hint]).toEqual(["Go", "Ctrl+G"]);
    item?.run();
    expect(run).toHaveBeenCalledOnce();
  });
});
