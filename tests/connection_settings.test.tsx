// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { ConnectionClient, ConnectionCredentials, ConnectionsView } from "../src/connection_protocol.ts";
import { ConnectionSettings } from "../src/web/react/connections.tsx";
import { Dialogs } from "../src/web/react/dialog.tsx";

afterEach(cleanup);

const local = { id: "local", name: "This computer", kind: "local", address: "", user: "" } as const;
const home = { id: "remote-1", name: "Home server", kind: "remote", address: "https://home.example.org", user: "ada" } as const;

// A client over a list held here, asking for the code the first time it adds a daemon.
function fake_client(start: ConnectionsView) {
  let view = start;
  const tries: { address: string; credentials: ConnectionCredentials; name?: string }[] = [];
  const client: ConnectionClient = {
    list_connections: async () => view,
    add_connection: async (address, credentials, name) => {
      tries.push({ address, credentials, name });
      if (!credentials.code) throw new Error("Error invoking remote method 'add_connection': Error: Enter the code from your authenticator app.");
      view = { ...view, connections: [...view.connections, { ...home, name: name || "home.example.org" }] };
      return view;
    },
    rename_connection: async (id, name) => (view = { ...view, connections: view.connections.map((each) => (each.id === id ? { ...each, name } : each)) }),
    remove_connection: async (id) => (view = { connections: view.connections.filter((each) => each.id !== id), current: view.current === id ? "local" : view.current }),
    choose_connection: async (id) => (view = { ...view, current: id }),
  };
  return { client, tries };
}

test("marks the daemon in use, adds another after asking for the code, and connects to it", async () => {
  const { client, tries } = fake_client({ connections: [local], current: "local" });
  render(<><ConnectionSettings client={client} /><Dialogs /></>);

  await waitFor(() => screen.getByText("This computer"));
  expect(screen.getByText("Connected")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Daemon address"), { target: { value: "home.example.org" } });
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Home server" } });
  fireEvent.click(screen.getByRole("button", { name: "Add daemon" }));
  fireEvent.change(await screen.findByLabelText("Code from your authenticator app, or a recovery code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Add daemon" }));

  await waitFor(() => screen.getByText("ada at https://home.example.org"));
  expect(tries.map((each) => each.credentials)).toEqual([{ name: "ada", password: "secret" }, { name: "ada", password: "secret", code: "123456" }]);
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");

  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(1));
  expect(screen.getByRole("button", { name: "Connect" }).closest(".setting-row")?.textContent).toContain("This computer");
});

test("renames and, after asking, removes a daemon on another host, offering no such buttons for this computer", async () => {
  const { client } = fake_client({ connections: [local, home], current: "remote-1" });
  render(<><ConnectionSettings client={client} /><Dialogs /></>);

  await waitFor(() => screen.getByText("Home server"));
  expect(screen.getAllByRole("button", { name: "Rename" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Attic NAS" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
  await waitFor(() => screen.getByText("Attic NAS"));

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByText("Attic NAS")).toBeNull());
  expect(screen.getByText("Connected").closest(".setting-row")?.textContent).toContain("This computer");
});

test("a portal app with no daemon yet says so", async () => {
  const { client } = fake_client({ connections: [], current: null });
  render(<ConnectionSettings client={client} />);

  await waitFor(() => screen.getByText("No daemon yet"));
});
