// The page's side of server/account_sign_in: signing in and out, the signed-in user's own account, and an admin's users
// and tokens. A desktop or phone app gives the server's address and signs in as a device to get a token of its own.

// ── Imports ──────────────────────────────────────────────────────────────────

import { ApiError, create_api, type ApiOptions } from "./api.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface Me {
  name: string;
  role: string;
  // Every role from least to most able.
  roles: string[];
  // The app's own rules for what the user reaches, or null for everything.
  access: unknown;
  via: "session" | "token" | "proxy";
  read_only: boolean;
  totp_enabled: boolean;
  source: "declared" | "page";
  has_password: boolean;
}

export interface SignInInfo {
  app_name: string;
  // The single sign-on provider's button and where it starts, or null when there is none.
  oidc: { label: string; start: string } | null;
}

export interface AccountUser {
  name: string;
  role: string;
  access: unknown;
  totp_enabled: boolean;
  has_password: boolean;
  source: "declared" | "page";
  created_epoch: number;
}

export interface AccountSession {
  id: number;
  // Whether "Keep me signed in" was ticked.
  remember: boolean;
  // What signed in, such as "Firefox on Linux".
  label: string;
  created_epoch: number;
  last_seen_epoch: number;
  expires_epoch: number | null;
  // Whether it is the session asking.
  current: boolean;
}

export interface AccountToken {
  id: number;
  name: string;
  owner: string;
  read_only: boolean;
  created_epoch: number;
  last_used_epoch: number | null;
}

export interface UserFields {
  name?: string;
  role?: string;
  access?: unknown;
  // Left empty on an edit, the password stays as it was.
  password?: string;
}

// A refused sign-in, saying whether the password was right and only the code is missing or wrong.
export class SignInRefused extends ApiError {
  code_needed: boolean;

  constructor(message: string, status: number | null, code_needed: boolean) {
    super(message, status);
    this.code_needed = code_needed;
  }
}

export interface SignInFields {
  name: string;
  password: string;
  // The code from an authenticator app, or a recovery code, once the server asks for it.
  code?: string;
  // Whether "Keep me signed in" is ticked.
  remember?: boolean;
}

export interface AccountsClientOptions extends Omit<ApiOptions, "open_paths"> {
  // Where the account routes live, such as "/api", or a server's address and path from a desktop or phone app.
  base?: string;
}

export type AccountsClient = ReturnType<typeof create_accounts_client>;

// ── Client ───────────────────────────────────────────────────────────────────

export function create_accounts_client(options: AccountsClientOptions = {}) {
  const base = (options.base ?? "/api").replace(/\/+$/, "");
  const login_path = `${base}/login`;
  const api = create_api({ login_needed_text: "Sign in first.", ...options, open_paths: [login_path, `${base}/auth/info`] });
  const fetch_function = options.fetch ?? fetch;
  const segment = (value: string | number) => encodeURIComponent(String(value));

  // Posts the sign-in, telling a wrong password from a missing second factor.
  async function post_sign_in<Answer>(body: object): Promise<Answer> {
    let response: Response;
    try {
      response = await fetch_function(login_path, { method: "POST", headers: { "content-type": "application/json", ...options.headers?.() }, body: JSON.stringify(body) });
    } catch (error) {
      throw new ApiError(`The server did not answer: ${(error as Error).message}`, null);
    }
    if (response.status === 204) return undefined as Answer;
    const answer = await response.json().catch(() => ({})) as { error?: string; code_needed?: boolean };
    if (!response.ok) throw new SignInRefused(answer.error ?? `${response.status} ${response.statusText}`, response.status, answer.code_needed === true);
    return answer as Answer;
  }

  return {
    info: () => api<SignInInfo>(`${base}/auth/info`),
    sign_in: (fields: SignInFields) => post_sign_in<void>(fields),
    // Signs a desktop or phone app in under the device's name, handing back the token it sends from then on.
    sign_in_device: (fields: SignInFields & { device: string }) => post_sign_in<{ token: string; id: number }>(fields),
    sign_out: () => api<void>(`${base}/logout`, "POST"),
    me: () => api<Me>(`${base}/me`),

    change_password: (current: string, next: string) => api<void>(`${base}/account/password`, "PUT", { current, next }),
    start_totp: () => api<{ secret: string; uri: string }>(`${base}/account/totp/start`, "POST", {}),
    confirm_totp: (code: string) => api<{ recovery_codes: string[] }>(`${base}/account/totp/confirm`, "POST", { code }),
    disable_totp: (code: string) => api<void>(`${base}/account/totp/disable`, "POST", { code }),
    sessions: () => api<AccountSession[]>(`${base}/account/sessions`),
    close_session: (id: number) => api<void>(`${base}/account/sessions/${segment(id)}`, "DELETE"),
    close_other_sessions: () => api<void>(`${base}/account/sessions`, "DELETE"),
    own_tokens: () => api<AccountToken[]>(`${base}/account/tokens`),
    create_token: (name: string, read_only: boolean) => api<{ token: string; id: number }>(`${base}/account/tokens`, "POST", { name, read_only }),
    delete_own_token: (id: number) => api<void>(`${base}/account/tokens/${segment(id)}`, "DELETE"),

    users: () => api<AccountUser[]>(`${base}/users`),
    create_user: (fields: UserFields) => api<AccountUser>(`${base}/users`, "POST", fields),
    update_user: (name: string, fields: UserFields) => api<AccountUser>(`${base}/users/${segment(name)}`, "PUT", fields),
    delete_user: (name: string) => api<void>(`${base}/users/${segment(name)}`, "DELETE"),
    reset_totp: (name: string) => api<void>(`${base}/users/${segment(name)}/totp/reset`, "POST", {}),
    sign_user_out: (name: string) => api<void>(`${base}/users/${segment(name)}/sessions`, "DELETE"),
    all_tokens: () => api<AccountToken[]>(`${base}/tokens`),
    delete_token: (id: number) => api<void>(`${base}/tokens/${segment(id)}`, "DELETE"),
  };
}
