// Signing in on the page: the name and password form, and the session the page keeps, checked once at start and lost
// whenever a request anywhere throws LoginNeeded. It pairs with server/password_sign_in.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { describe_error } from "../errors.ts";
import { LoginNeeded } from "../states.ts";

// ── Session ──────────────────────────────────────────────────────────────────

// Checking until the first answer, then the login form, or open for a user.
export type Session = { state: "checking" } | { state: "login" } | { state: "open"; user: string };

// The session as the check finds it; any later LoginNeeded left unhandled brings the login back.
export function use_session(check: () => Promise<string>): [Session, (session: Session) => void] {
  const [session, set_session] = useState<Session>({ state: "checking" });

  useEffect(() => {
    // Only LoginNeeded asks for a login; a server that is down shows its own failures in the views.
    check().then(
      (user) => set_session({ state: "open", user }),
      (error) => set_session(error instanceof LoginNeeded ? { state: "login" } : { state: "open", user: "" }),
    );
    const lapsed = (event: PromiseRejectionEvent) => {
      if (!(event.reason instanceof LoginNeeded)) return;
      event.preventDefault();
      set_session({ state: "login" });
    };
    window.addEventListener("unhandledrejection", lapsed);
    return () => window.removeEventListener("unhandledrejection", lapsed);
  }, []);

  return [session, set_session];
}

// ── Form ─────────────────────────────────────────────────────────────────────

interface LoginFormProps {
  // The app's name over the form, and in the tab's title while it shows.
  title: string;
  icon?: string;
  // Signs in, throwing what went wrong; on success the form hands the name on, trimmed and lower case.
  log_in: (name: string, password: string) => Promise<void>;
  on_login: (name: string) => void;
}

export function LoginForm({ title, icon, log_in, on_login }: LoginFormProps) {
  const name = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const [message, set_message] = useState("");
  const [busy, set_busy] = useState(false);

  useEffect(() => {
    document.title = `Log in · ${title}`;
    name.current?.focus();
  }, [title]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    set_busy(true);
    set_message("");
    const user_name = name.current!.value;
    try {
      await log_in(user_name, password.current!.value);
      on_login(user_name.trim().toLowerCase());
    } catch (error) {
      set_message(describe_error(error));
      password.current?.select();
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
      <button type="submit" className="accent solid" disabled={busy}>Log in</button>
      <p className="tone-bad" role="alert">{message}</p>
    </form>
  );
}
