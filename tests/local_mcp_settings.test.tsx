// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { LocalMcpSettings as Settings, LocalMcpStatus } from "../src/local_mcp_protocol.ts";
import { LocalMcpSettings } from "../src/web/react/local_mcp_settings.tsx";

afterEach(cleanup);

function fake_device() {
  let settings: Settings = { enabled: false, port: 3920 };
  let status: LocalMcpStatus = { state: "off", url: "", error: "" };
  return {
    get_local_mcp_settings: vi.fn(async () => settings),
    set_local_mcp_settings: vi.fn(async (next: Settings) => {
      settings = next;
      status = next.enabled ? { state: "running", url: `http://127.0.0.1:${next.port}/mcp`, error: "" } : { state: "off", url: "", error: "" };
    }),
    get_local_mcp_status: vi.fn(async () => status),
  };
}

test("turning it on starts it and shows the command that adds it to Claude Code", async () => {
  const device = fake_device();
  render(<LocalMcpSettings device={device} name="x-notes" />);

  const toggle = await screen.findByRole("switch", { name: "MCP server" });
  await act(async () => fireEvent.click(toggle));

  expect(device.set_local_mcp_settings).toHaveBeenCalledWith({ enabled: true, port: 3920 });
  expect(screen.getByText("Listening on http://127.0.0.1:3920/mcp")).toBeTruthy();
  expect(screen.getByText("claude mcp add --transport http x-notes http://127.0.0.1:3920/mcp")).toBeTruthy();
});

test("a port that cannot be used says why", async () => {
  const device = fake_device();
  device.get_local_mcp_settings.mockResolvedValue({ enabled: true, port: 3920 });
  device.get_local_mcp_status.mockResolvedValue({ state: "failed", url: "", error: "listen EADDRINUSE" });
  render(<LocalMcpSettings device={device} name="x-notes" />);

  expect(await screen.findByText("Could not start: listen EADDRINUSE")).toBeTruthy();
  expect(screen.queryByText(/claude mcp add/)).toBeNull();
});
