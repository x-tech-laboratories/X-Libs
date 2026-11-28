// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppView, render_app } from "../src/app/web/app_page.tsx";
import type { AppPages } from "../src/app/web/settings_page.tsx";
import { set_page_api } from "../src/app/web/page.ts";
import type { PageApi } from "../src/app/protocol.ts";
import { sample_app } from "./app/sample_app.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

// ============================================================================
// Helpers
// ============================================================================

const pages: AppPages = {
  app: sample_app,
  pages: [
    { id: "notes", label: "Notes", view: (parts) => <p>Every note {parts.join("/")}</p> },
    { id: "trash", label: "Trash", view: () => <p>Thrown away</p> },
  ],
};

const calls = { get_settings: vi.fn(async () => ({})) } as unknown as PageApi["calls"];

function device_page(): void {
  set_page_api({ host: "desktop", calls, device: null, backups: null, on_change: () => () => undefined });
}

// A browser whose server answers who is signed in, or that nobody is.
function browser_page(me: object | null): void {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path.endsWith("/me")) return me ? new Response(JSON.stringify(me), { status: 200 }) : new Response("", { status: 401 });
    if (path.endsWith("/auth/info")) return new Response(JSON.stringify({ methods: ["password"] }), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  set_page_api({ host: "web", calls, device: null, backups: null, on_change: () => () => undefined });
}

const admin = { name: "admin", role: "admin", roles: ["user", "admin"], access: null, via: "session", read_only: false };

// ============================================================================
// Pages
// ============================================================================

describe("app page", () => {
  it("opens on the first page in the Shell, its sections in the sidebar and its name in the title", async () => {
    device_page();

    render(<AppView pages={pages} />);

    expect(await screen.findByText("Every note")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Trash" }).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.title).toBe("Notes · X-Sample"));
  });

  it("goes to a page, passing it the rest of the route, and to Settings", async () => {
    device_page();
    render(<AppView pages={pages} />);

    act(() => void (window.location.hash = "/notes/note-1"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText("Every note note-1")).toBeTruthy();

    act(() => void (window.location.hash = "/settings"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("asks a browser to sign in to the server first", async () => {
    browser_page(null);

    render(<AppView pages={pages} />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText("Every note")).toBeNull();
  });

  it("shows a signed-in browser its pages and its account", async () => {
    browser_page(admin);
    render(<AppView pages={pages} />);
    expect(await screen.findByText("Every note")).toBeTruthy();

    act(() => void (window.location.hash = "/account"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect((await screen.findAllByRole("heading", { name: "Your account" })).length).toBeGreaterThan(0);
  });

  it("starts on the desktop host when the preload put its calls on the window", async () => {
    const exposed = window as unknown as Record<string, unknown>;
    const { bridges } = sample_app;
    exposed[bridges.calls.api_name] = calls;
    exposed[bridges.connections.api_name] = { list_connections: async () => ({ connections: [], current: "local" }) };
    exposed[bridges.events.api_name] = { on: () => () => undefined };
    const root = document.createElement("div");
    document.body.append(root);

    await act(() => render_app({ ...pages, app: sample_app }, root));

    expect(await screen.findByText("Every note")).toBeTruthy();
    for (const name of [bridges.calls.api_name, bridges.connections.api_name, bridges.events.api_name]) delete exposed[name];
  });
});
