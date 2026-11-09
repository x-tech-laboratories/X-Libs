import { describe, expect, it, vi } from "vitest";
import { create_plugin_host, define_plugin, json_plugin_storage, type Plugin, type PluginRecords } from "../src/plugins.ts";

interface Api {
  hooks: { "task.created": (task: { title: string }) => void };
  providers: { source: { fetch(): string } };
  slots: { sidebar: string };
  services: { greeting: string };
}

const app = { id: "x-tasks", version: "1.4.0" };

function plugin(id: string, extra: Partial<Plugin<Api>> = {}): Plugin<Api> {
  return { id, name: id, version: "1.0.0", start: () => {}, ...extra };
}

function memory_storage(initial: PluginRecords = {}) {
  let text = JSON.stringify(initial);
  return { storage: json_plugin_storage({ get: () => text, set: (next) => { text = next; } }), saved: () => JSON.parse(text) as PluginRecords };
}

describe("plugin host", () => {
  it("starts plugins after the ones they require, whatever order they were added in", async () => {
    const order: string[] = [];
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("b", { requires: { a: "^1.0.0" }, start: () => void order.push("b") }));
    await host.add(plugin("a", { start: () => void order.push("a") }));
    await host.start();

    expect(order).toEqual(["a", "b"]);
    expect(host.list().map((status) => status.state)).toEqual(["running", "running"]);
  });

  it("keeps a plugin waiting while what it requires is missing, too old or off, and says why", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("missing", { requires: { ghost: "*" } }));
    await host.add(plugin("old", { version: "0.9.0" }));
    await host.add(plugin("wants-new", { requires: { old: "^1.0.0" } }));
    await host.add(plugin("off", { enabled_by_default: false }));
    await host.add(plugin("wants-off", { requires: { off: "*" } }));
    await host.start();

    const problems = Object.fromEntries(host.list().map((status) => [status.manifest.id, [status.state, status.problem]]));
    expect(problems["missing"]).toEqual(["waiting", "It needs ghost *, which is not installed."]);
    expect(problems["wants-new"]).toEqual(["waiting", "It needs old ^1.0.0; 0.9.0 is installed."]);
    expect(problems["wants-off"]).toEqual(["waiting", "It needs off running."]);

    await host.enable("off");
    expect(host.list().find((status) => status.manifest.id === "wants-off")?.state).toBe("running");
  });

  it("refuses a plugin for another app, another app version or with a bad version", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("other", { app: "x-music" }));
    await host.add(plugin("future", { app_versions: "^2.0.0" }));
    await host.add(plugin("odd", { version: "one" }));
    await host.add(plugin("fine", { app: "x-tasks", app_versions: ">=1.2" }));
    await host.start();

    expect(host.list().map((status) => [status.state, status.problem])).toEqual([
      ["unsupported", "It is for x-music, not x-tasks."],
      ["unsupported", "It needs x-tasks ^2.0.0; this is 1.4.0."],
      ["unsupported", 'Its version "one" is not semver.'],
      ["running", undefined],
    ]);
  });

  it("removes everything a plugin added when it is turned off, and gives it back when it is turned on", async () => {
    const stopped = vi.fn();
    const cleaned = vi.fn();
    const seen: string[] = [];
    const host = create_plugin_host<Api>({ app });
    await host.add(define_plugin<Api>({
      id: "all", name: "All", version: "1.0.0",
      start(context) {
        context.hook("task.created", (task) => void seen.push(task.title));
        context.provide("source", "web", { fetch: () => "page" });
        context.add_command({ id: "hello", label: "Say hello", keys: "mod+h", run: () => {} });
        context.fill_slot("sidebar", "panel");
        context.on_stop(cleaned);
      },
      stop: stopped,
    }));
    await host.start();

    await host.call("task.created", { title: "first" });
    expect(host.provider("source")?.value.fetch()).toBe("page");
    expect(host.commands().map((command) => command.id)).toEqual(["all.hello"]);
    expect(host.slot("sidebar")).toEqual([{ plugin_id: "all", value: "panel" }]);

    await host.disable("all");
    await host.call("task.created", { title: "second" });
    expect(seen).toEqual(["first"]);
    expect(host.providers("source")).toEqual([]);
    expect(host.commands()).toEqual([]);
    expect(host.slot("sidebar")).toEqual([]);
    expect(stopped).toHaveBeenCalledOnce();
    expect(cleaned).toHaveBeenCalledOnce();

    await host.enable("all");
    expect(host.slot("sidebar")).toHaveLength(1);
  });

  it("stops the plugins that require one before it, and starts them again when it is back", async () => {
    const order: string[] = [];
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("base", { stop: () => void order.push("base") }));
    await host.add(plugin("top", { requires: { base: "*" }, stop: () => void order.push("top") }));
    await host.start();

    await host.disable("base");
    expect(order).toEqual(["top", "base"]);
    expect(host.list().map((status) => status.state)).toEqual(["off", "waiting"]);

    await host.enable("base");
    expect(host.list().map((status) => status.state)).toEqual(["running", "running"]);
  });

  it("marks a plugin that throws on start as failed, takes back what it added, and keeps the others going", async () => {
    const on_error = vi.fn();
    const host = create_plugin_host<Api>({ app, on_error });
    await host.add(plugin("broken", { start(context) { context.fill_slot("sidebar", "half"); throw new Error("no network"); } }));
    await host.add(plugin("fine"));
    await host.start();

    expect(host.list().map((status) => [status.state, status.problem])).toEqual([["failed", "no network"], ["running", undefined]]);
    expect(host.slot("sidebar")).toEqual([]);
    expect(on_error).toHaveBeenCalledWith("broken", expect.any(Error));
  });

  it("tries a failed plugin again once it is turned off and on", async () => {
    let tries = 0;
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("flaky", { start: () => { tries += 1; if (tries === 1) throw new Error("first try"); } }));
    await host.start();
    expect(host.list()[0]?.state).toBe("failed");

    await host.disable("flaky");
    expect(host.list()[0]?.state).toBe("off");
    await host.enable("flaky");
    expect([host.list()[0]?.state, tries]).toEqual(["running", 2]);
  });

  it("tells the app about a hook that throws and still runs the hooks after it", async () => {
    const on_error = vi.fn();
    const seen: string[] = [];
    const host = create_plugin_host<Api>({ app, on_error });
    await host.add(plugin("thrower", { start: (context) => context.hook("task.created", () => { throw new Error("bad"); }) }));
    await host.add(plugin("listener", { start: (context) => context.hook("task.created", (task) => void seen.push(task.title)) }));
    host.hook("task.created", (task) => void seen.push(`app:${task.title}`));
    await host.start();

    await host.call("task.created", { title: "one" });
    expect(seen).toEqual(["app:one", "one"]);
    expect(on_error).toHaveBeenCalledWith("thrower", expect.any(Error));
  });

  it("picks a provider by id, or the first one when that id is gone", async () => {
    const host = create_plugin_host<Api>({ app });
    await host.add(plugin("one", { start: (context) => context.provide("source", "first", { fetch: () => "1" }) }));
    await host.add(plugin("two", { start: (context) => context.provide("source", "second", { fetch: () => "2" }) }));
    await host.start();

    expect(host.provider("source", "second")?.value.fetch()).toBe("2");
    expect(host.provider("source", "gone")?.id).toBe("first");
    expect(host.providers("source").map((item) => item.plugin_id)).toEqual(["one", "two"]);
  });

  it("keeps on/off and settings in storage, and falls back to the default for a stored value that no longer fits", async () => {
    const { storage, saved } = memory_storage({ s: { enabled: false, settings: { size: 99, mode: "gone" } } });
    const changes = vi.fn();
    const settings_plugin = plugin("s", {
      settings: [
        { key: "size", label: "Size", type: "number", default: 5, min: 1, max: 10 },
        { key: "mode", label: "Mode", type: "choice", default: "a", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
      ],
      start: (context) => context.on_settings_change(changes),
    });
    const host = create_plugin_host<Api>({ app, storage });
    await host.add(settings_plugin);
    await host.start();

    expect(host.list()[0]?.state).toBe("off");
    expect(host.settings("s")).toEqual({ size: 5, mode: "a" });

    await host.enable("s");
    await host.set_settings("s", { mode: "b" });
    expect(changes).toHaveBeenCalledWith({ size: 5, mode: "b" });
    expect(saved()).toEqual({ s: { enabled: true, settings: { size: 5, mode: "b" } } });
  });

  it("hands every plugin the app's services and starts a plugin added after the host started", async () => {
    const greetings: string[] = [];
    const host = create_plugin_host<Api>({ app, services: { greeting: "hi" } });
    await host.start();
    await host.add(plugin("late", { start: (context) => void greetings.push(context.services.greeting) }));

    expect(greetings).toEqual(["hi"]);
    await expect(host.add(plugin("late"))).rejects.toThrow('A plugin "late" is already installed.');
  });

  it("bumps its watch on every change a page shows", async () => {
    const host = create_plugin_host<Api>({ app });
    const seen = vi.fn();
    host.watch.subscribe(seen);
    await host.add(plugin("a"));
    await host.start();
    await host.disable("a");

    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(host.watch.version()).toBe(seen.mock.calls.length);
  });
});
