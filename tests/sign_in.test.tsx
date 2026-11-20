// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { create_accounts_client, type Me } from "../src/web/accounts.ts";
import { AccountView, users_settings, UsersView } from "../src/web/react/accounts.tsx";
import { Dialogs } from "../src/web/react/dialog.tsx";
import { SettingsPage } from "../src/web/react/layout.tsx";
import { SignInForm, use_account } from "../src/web/react/sign_in.tsx";

afterEach(cleanup);

const me: Me = {
  name: "root", role: "admin", roles: ["viewer", "admin"], access: null, via: "session", read_only: false,
  totp_enabled: false, source: "declared", has_password: true,
};

// A server answering each path with the reply given, keeping every request body.
function server(replies: Record<string, (body: Record<string, unknown>) => Response>, bodies: Record<string, unknown>[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    bodies.push(body);
    const reply = replies[String(input)];
    return reply ? reply(body) : new Response("", { status: 404 });
  }) as typeof fetch;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function fill(name: string, password: string) {
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

const submit = () => fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

test("the form asks for the code once the password is right, and sends whether to keep the session", async () => {
  const bodies: Record<string, unknown>[] = [];
  const client = create_accounts_client({
    fetch: server({
      "/api/auth/info": () => json({ app_name: "X-Test", oidc: null }),
      "/api/login": (body) => body.code === "123456" ? new Response(null, { status: 204 }) : json({ error: "Enter the code from your authenticator app.", code_needed: true }, 401),
    }, bodies),
  });
  let signed_in = false;
  render(<SignInForm client={client} title="X-Test" on_signed_in={() => { signed_in = true; }} />);

  fill("root", "secret");
  fireEvent.click(screen.getByLabelText("Keep me signed in"));
  submit();
  await waitFor(() => expect(screen.getByLabelText("Code from your authenticator app, or a recovery code").closest("label")!.hidden).toBe(false));
  fireEvent.change(screen.getByLabelText("Code from your authenticator app, or a recovery code"), { target: { value: "123456" } });
  submit();

  await waitFor(() => expect(signed_in).toBe(true));
  expect(bodies.at(-1)).toEqual({ name: "root", password: "secret", code: "123456", remember: true });
  expect(document.title).toBe("Sign in · X-Test");
});

test("the form says why signing in failed and offers single sign-on", async () => {
  const client = create_accounts_client({
    fetch: server({
      "/api/auth/info": () => json({ app_name: "X-Test", oidc: { label: "Example ID", start: "/api/auth/oidc/start" } }),
      "/api/login": () => json({ error: "Wrong name or password." }, 401),
    }),
  });
  render(<SignInForm client={client} title="X-Test" on_signed_in={() => {}} />);

  fill("root", "wrong");
  submit();

  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Wrong name or password."));
  expect(screen.getByRole("link", { name: "Sign in with Example ID" }).getAttribute("href")).toBe("/api/auth/oidc/start?remember=0");
});

function AccountProbe({ client }: { client: ReturnType<typeof create_accounts_client> }) {
  const { account } = use_account(client);
  return <p>{account.state === "signed_in" ? account.me.name : account.state}</p>;
}

test("the account is signed out when the server asks for a sign-in", async () => {
  const client = create_accounts_client({ fetch: server({ "/api/me": () => json({ error: "Sign in first." }, 401) }) });

  render(<AccountProbe client={client} />);

  await waitFor(() => expect(screen.getByText("signed_out")).toBeTruthy());
});

test("the users page lists everyone and marks who is signed in", async () => {
  const client = create_accounts_client({
    fetch: server({
      "/api/users": () => json([
        { name: "root", role: "admin", access: null, totp_enabled: false, has_password: true, source: "declared", created_epoch: 0 },
        { name: "vera", role: "viewer", access: null, totp_enabled: true, has_password: true, source: "page", created_epoch: 0 },
      ]),
      "/api/tokens": () => json([]),
    }),
  });

  render(<UsersView client={client} me={me} role_text={{ viewer: "Sees everything; changes nothing." }} />);

  await waitFor(() => expect(screen.getAllByText("vera").length).toBeGreaterThan(0));
  expect(screen.getAllByText("(you)").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: "Reset second factor" }).length).toBeGreaterThan(0);
});

test("the users page names its list apart from the page's own heading", async () => {
  const client = create_accounts_client({ fetch: server({ "/api/users": () => json([]), "/api/tokens": () => json([]) }) });

  render(<UsersView client={client} me={me} />);

  expect(screen.getAllByRole("heading", { name: "Users" })).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Who can sign in" })).toBeTruthy();
});

test("the users settings give an admin Users and Tokens sections, with Add user, and anyone else none", async () => {
  const client = create_accounts_client({
    fetch: server({
      "/api/users": () => json([{ name: "vera", role: "viewer", access: null, totp_enabled: false, has_password: true, source: "page", created_epoch: 0 }]),
      "/api/tokens": () => json([]),
    }),
  });

  render(<SettingsPage categories={[{ heading: "Server", sections: users_settings({ client, me }) }]} />);

  expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Tokens" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add user" })).toBeTruthy();
  await waitFor(() => expect(screen.getAllByText("vera").length).toBeGreaterThan(0));
  expect(users_settings({ client, me: { ...me, role: "viewer" } })).toEqual([]);
});

// The account page's server: the signed-in user, no sessions, and the tokens and scopes given.
function account_server(tokens: unknown[], scopes: unknown[] | null, bodies: Record<string, unknown>[]): typeof fetch {
  return server({
    "/api/me": () => json(me),
    "/api/account/sessions": () => json([]),
    "/api/account/tokens": (body) => (body.name ? json({ token: "xt_new", id: 9 }, 201) : json(tokens)),
    ...(scopes === null ? {} : { "/api/account/token_scopes": () => json(scopes) }),
  }, bodies);
}

const scoped_token = { id: 3, name: "adder", owner: "root", read_only: true, scope: "add_items", created_epoch: 0, last_used_epoch: null };
const reading_token = { id: 4, name: "reader", owner: "root", read_only: true, scope: null, created_epoch: 0, last_used_epoch: null };

test("the token form offers the app's scopes, and the list names each token's", async () => {
  const bodies: Record<string, unknown>[] = [];
  const scopes = [{ id: "add_items", label: "Add items", hint: "Reads, and adds items.", calls: ["add_item"] }];
  render(<><AccountView client={create_accounts_client({ fetch: account_server([scoped_token, reading_token], scopes, bodies) })} /><Dialogs /></>);

  await waitFor(() => expect(screen.getByText("Add items")).toBeTruthy());
  expect(screen.getByText("read only")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "phone shortcut" } });
  await screen.findByRole("combobox", { name: "May" });
  expect(screen.getByText("Read, and change nothing.")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "May" }), { target: { value: "add_items" } });
  expect(screen.getByText("Reads, and adds items.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() => expect(bodies.find((body) => body.name === "phone shortcut")).toEqual({ name: "phone shortcut", read_only: true, scope: "add_items" }));
  expect(await screen.findByText("xt_new")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
});

test("the token form makes a full token when Everything is picked", async () => {
  const bodies: Record<string, unknown>[] = [];
  const scopes = [{ id: "tidy", label: "Tidy", hint: "", calls: ["delete_item"] }];
  render(<><AccountView client={create_accounts_client({ fetch: account_server([], scopes, bodies) })} /><Dialogs /></>);

  await waitFor(() => expect(screen.getByRole("button", { name: "Create token" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "laptop" } });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "May" })).toBeTruthy());
  fireEvent.change(screen.getByRole("combobox", { name: "May" }), { target: { value: "tidy" } });
  expect(screen.getByText("Read, and delete_item.")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "May" }), { target: { value: ":full" } });
  expect(screen.getByText("Everything you can do, except manage your account.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() => expect(bodies.find((body) => body.name === "laptop")).toEqual({ name: "laptop", read_only: false }));
});

test("the token form keeps its Read only box on a server with no scopes", async () => {
  const bodies: Record<string, unknown>[] = [];
  render(<><AccountView client={create_accounts_client({ fetch: account_server([], null, bodies) })} /><Dialogs /></>);

  await waitFor(() => expect(screen.getByRole("button", { name: "Create token" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  expect(screen.queryByRole("combobox", { name: "May" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "script" } });
  fireEvent.click(screen.getByLabelText("Read only"));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() => expect(bodies.find((body) => body.name === "script")).toEqual({ name: "script", read_only: false }));
});
