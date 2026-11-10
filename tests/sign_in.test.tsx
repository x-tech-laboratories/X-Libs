// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { create_accounts_client, type Me } from "../src/web/accounts.ts";
import { UsersView } from "../src/web/react/accounts.tsx";
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
