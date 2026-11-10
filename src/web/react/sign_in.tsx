// Signing in on the page: the form every app with accounts shows (name, password, the second factor when asked for,
// "Keep me signed in" and single sign-on), and the account the page is signed in as, lost whenever a request anywhere
// throws LoginNeeded. It pairs with server/account_sign_in through web/accounts.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { SignInRefused, type AccountsClient, type Me, type SignInInfo } from "../accounts.ts";
import { describe_error } from "../errors.ts";
import { current_route } from "../router.ts";
import { LoginNeeded } from "../states.ts";

// ── Account ──────────────────────────────────────────────────────────────────

// Checking until the first answer, then the sign-in form, or signed in.
export type AccountState = { state: "checking" } | { state: "signed_out" } | { state: "signed_in"; me: Me };

export interface UseAccount {
  account: AccountState;
  // Asks the server again, such as after signing in or changing the second factor.
  refresh: () => Promise<void>;
  // Signs out on the server and shows the form.
  sign_out: () => Promise<void>;
}

export function use_account(client: AccountsClient): UseAccount {
  const [account, set_account] = useState<AccountState>({ state: "checking" });

  const refresh = async () => {
    try {
      set_account({ state: "signed_in", me: await client.me() });
    } catch (error) {
      if (!(error instanceof LoginNeeded)) throw error;
      set_account({ state: "signed_out" });
    }
  };

  useEffect(() => {
    void refresh();
    const lapsed = (event: PromiseRejectionEvent) => {
      if (!(event.reason instanceof LoginNeeded)) return;
      event.preventDefault();
      set_account({ state: "signed_out" });
    };
    window.addEventListener("unhandledrejection", lapsed);
    return () => window.removeEventListener("unhandledrejection", lapsed);
  }, [client]);

  const sign_out = async () => {
    await client.sign_out().catch(() => {});
    set_account({ state: "signed_out" });
  };

  return { account, refresh, sign_out };
}

// ── Form ─────────────────────────────────────────────────────────────────────

interface SignInFormProps {
  client: AccountsClient;
  // The app's name over the form, and in the tab's title while it shows.
  title: string;
  icon?: string;
  // Runs once signed in, such as the account's refresh.
  on_signed_in: () => void | Promise<void>;
}

export function SignInForm({ client, title, icon, on_signed_in }: SignInFormProps) {
  const name = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const code = useRef<HTMLInputElement>(null);
  const [remember, set_remember] = useState(false);
  const [asks_code, set_asks_code] = useState(false);
  // An error single sign-on sent back in the address.
  const [message, set_message] = useState(() => current_route().query.get("sign_in_error") ?? "");
  const [busy, set_busy] = useState(false);
  const [info, set_info] = useState<SignInInfo | null>(null);

  useEffect(() => {
    document.title = `Sign in · ${title}`;
    name.current?.focus();
    client.info().then(set_info, () => {});
  }, [client, title]);

  useEffect(() => {
    if (asks_code) code.current?.focus();
  }, [asks_code]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    set_busy(true);
    set_message("");
    try {
      await client.sign_in({ name: name.current!.value, password: password.current!.value, code: asks_code ? code.current!.value : undefined, remember });
      if (location.hash.includes("sign_in_error=")) history.replaceState(null, "", location.pathname + "#/");
      await on_signed_in();
    } catch (error) {
      // The server asks for the second factor only once the password is right.
      if (error instanceof SignInRefused && error.code_needed && !asks_code) {
        set_asks_code(true);
      } else {
        set_message(describe_error(error));
        (asks_code ? code : password).current?.select();
      }
      set_busy(false);
    }
  };

  return (
    <form className="login" onSubmit={(event) => void submit(event)}>
      <div className="login-brand">{icon && <img src={icon} alt="" width={96} height={96} />}<h1>{title}</h1></div>
      <label className="field">
        <span className="field-label">User name</span>
        <input ref={name} type="text" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <input ref={password} type="password" name="password" autoComplete="current-password" required />
      </label>
      <label className="field" hidden={!asks_code}>
        <span className="field-label">Code from your authenticator app, or a recovery code</span>
        <input ref={code} type="text" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" />
      </label>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(event) => set_remember(event.currentTarget.checked)} /> Keep me signed in
      </label>
      <button type="submit" className="accent solid" disabled={busy}>Sign in</button>
      <p className="tone-bad" role="alert">{message}</p>
      {info?.oidc && <>
        <p className="muted small">or</p>
        <a className="button" href={`${info.oidc.start}?remember=${remember ? 1 : 0}`}>{`Sign in with ${info.oidc.label}`}</a>
      </>}
    </form>
  );
}
