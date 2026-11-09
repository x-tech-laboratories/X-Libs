// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { FormRow } from "../src/web/react/layout.tsx";
import { LoginForm, use_session, type Session } from "../src/web/react/login.tsx";
import { LoginNeeded } from "../src/web/states.ts";

afterEach(cleanup);

function fill(name: string, password: string) {
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.submit(screen.getByRole("button", { name: "Log in" }).closest("form")!);
}

test("the login form hands on the trimmed, lower-case name once signed in", async () => {
  const tries: [string, string][] = [];
  let signed_in = "";
  render(<LoginForm title="X-Test" log_in={async (name, password) => void tries.push([name, password])} on_login={(name) => (signed_in = name)} />);

  fill(" Ada ", "right");

  await waitFor(() => expect(signed_in).toBe("ada"));
  expect(tries).toEqual([[" Ada ", "right"]]);
  expect(document.title).toBe("Log in · X-Test");
});

test("the login form says why signing in failed", async () => {
  render(<LoginForm title="X-Test" log_in={async () => { throw new Error("Wrong name or password."); }} on_login={() => {}} />);

  fill("ada", "wrong");

  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Wrong name or password."));
});

function SessionProbe({ check, seen }: { check: () => Promise<string>; seen: Session[] }) {
  const [session] = use_session(check);
  seen.push(session);
  return <p>{session.state}</p>;
}

test("the session opens for the user the check names, and a LoginNeeded asks for a login", async () => {
  const seen: Session[] = [];
  render(<SessionProbe check={async () => "ada"} seen={seen} />);

  await waitFor(() => expect(seen.at(-1)).toEqual({ state: "open", user: "ada" }));
  await act(async () => {
    window.dispatchEvent(Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason: new LoginNeeded("Log in first.") }));
  });

  expect(seen.at(-1)).toEqual({ state: "login" });
});

test("a check that needs a login starts at the login", async () => {
  const seen: Session[] = [];
  render(<SessionProbe check={async () => { throw new LoginNeeded("Log in first."); }} seen={seen} />);

  await waitFor(() => expect(seen.at(-1)).toEqual({ state: "login" }));
});

test("a form row's label names its control and shows its hint", () => {
  render(<div className="form-rows"><FormRow label="SSH port" id="port" hint="22 unless set."><input id="port" /></FormRow></div>);

  expect(screen.getByLabelText("SSH port").id).toBe("port");
  expect(screen.getByText("22 unless set.")).toBeTruthy();
});
