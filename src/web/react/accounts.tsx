// The account pages every app with accounts shows: "Your account" with the password, second factor, sessions and tokens
// of whoever is signed in, and an admin's "Users" with everyone's role, access, second factor and tokens, as a page or
// as sections of the settings page. The app says what its roles mean and, when it grants more than everything or
// nothing, how access reads and is picked.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useState, type ComponentType, type ReactNode } from "react";
import type { AccountSession, AccountsClient, AccountToken, AccountUser, Me } from "../accounts.ts";
import { ApiError } from "../api.ts";
import { age, stamp } from "../format.ts";
import { Chip } from "./badges.tsx";
import { confirm_dialog, Dialog, open_dialog } from "./dialog.tsx";
import { Facts, FormRow, PageHeading, Section, type SettingsSection } from "./layout.tsx";
import { Empty, Loaded, use_resource } from "./states.tsx";
import { DataTable } from "./table.tsx";
import { Age } from "./time.tsx";
import { toast } from "./toasts.tsx";

// ── Shapes ───────────────────────────────────────────────────────────────────

// What the app's access rules look like to people, shared by both pages.
export interface AccessWords {
  // What each role may do, in a sentence.
  role_text?: Record<string, string>;
  // The access in words; "everything" for null and "limited" otherwise unless set.
  access_text?: (access: unknown) => string;
}

// Picks a user's access in the user dialog; left out, every user reaches everything.
export type AccessEditor = ComponentType<{ value: unknown; on_change: (value: unknown) => void }>;

const default_access_text = (access: unknown) => access === null ? "everything" : "limited";

// ── Your account ─────────────────────────────────────────────────────────────

interface AccountViewProps extends AccessWords {
  client: AccountsClient;
  // Runs after a change the rest of the page shows, such as turning the second factor on.
  on_change?: () => void;
}

export function AccountView({ client, on_change, ...words }: AccountViewProps) {
  const me = use_resource(client.me, [client]);
  const refresh = () => {
    void me.reload(true);
    on_change?.();
  };
  return (
    <div className="page">
      <PageHeading title="Your account" />
      <div className="stack">
        <Loaded resource={me} lines={4}>{(who) => <AccountPanels client={client} who={who} words={words} refresh={refresh} />}</Loaded>
      </div>
    </div>
  );
}

function AccountPanels({ client, who, words, refresh }: { client: AccountsClient; who: Me; words: AccessWords; refresh: () => void }) {
  const access_text = words.access_text ?? default_access_text;
  const role_note = words.role_text?.[who.role];
  return <>
    <Section title="You">
      <Facts rows={[
        ["Name", who.name],
        ["Role", role_note ? `${who.role}: ${role_note}` : who.role],
        ["Access", access_text(who.access)],
        ["Signed in through", who.via === "proxy" ? "the reverse proxy" : who.via === "token" ? "a token" : "this page"],
      ]} />
    </Section>
    <Section title="Password">
      {who.source === "declared"
        ? <p className="muted">Your password is in the accounts file this server is set up with; change it there with npm run hash-password.</p>
        : <PasswordForm client={client} />}
    </Section>
    <Section title="Second factor"><TotpPanel key={String(who.totp_enabled)} client={client} enabled={who.totp_enabled} refresh={refresh} /></Section>
    <Section title="Where you are signed in"><SessionsPanel client={client} /></Section>
    <Section title="Tokens"><OwnTokensPanel client={client} /></Section>
  </>;
}

function PasswordForm({ client }: { client: AccountsClient }) {
  const [current, set_current] = useState("");
  const [next, set_next] = useState("");
  const [repeat, set_repeat] = useState("");
  const [message, set_message] = useState<{ text: string; tone: "good" | "bad" } | null>(null);

  async function save(): Promise<void> {
    if (next !== repeat) {
      set_message({ text: "The two new passwords differ.", tone: "bad" });
      return;
    }
    try {
      await client.change_password(current, next);
      set_current("");
      set_next("");
      set_repeat("");
      set_message({ text: "Changed. Your other sessions were signed out.", tone: "good" });
    } catch (error) {
      set_message({ text: refusal_of(error), tone: "bad" });
    }
  }

  return (
    <div className="form-rows">
      <FormRow label="Current password" id="current-password">
        <input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(event) => set_current(event.currentTarget.value)} />
      </FormRow>
      <FormRow label="New password" id="new-password">
        <input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(event) => set_next(event.currentTarget.value)} />
      </FormRow>
      <FormRow label="New password again" id="new-password-again">
        <input id="new-password-again" type="password" autoComplete="new-password" value={repeat} onChange={(event) => set_repeat(event.currentTarget.value)} />
      </FormRow>
      <div>
        <button className="accent solid" onClick={() => void save()}>Change password</button>
        <p className={message ? `small tone-${message.tone}` : "small"} role="status">{message?.text ?? ""}</p>
      </div>
    </div>
  );
}

function TotpPanel({ client, enabled, refresh }: { client: AccountsClient; enabled: boolean; refresh: () => void }) {
  const [code, set_code] = useState("");
  const [message, set_message] = useState("");
  const [setup, set_setup] = useState<{ secret: string; uri: string } | null>(null);

  const code_field = (
    <input id="totp-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus={setup !== null} value={code}
      onChange={(event) => set_code(event.currentTarget.value)} />
  );

  async function turn_off(): Promise<void> {
    try {
      await client.disable_totp(code);
      toast("Second factor turned off.", { tone: "warn" });
      refresh();
    } catch (error) {
      set_message(refusal_of(error));
    }
  }

  async function confirm(): Promise<void> {
    try {
      const { recovery_codes } = await client.confirm_totp(code);
      refresh();
      show_once("Your recovery codes", "Each signs you in once if you lose your phone. Keep them somewhere safe; they are not shown again.", recovery_codes);
    } catch (error) {
      set_message(refusal_of(error));
    }
  }

  if (enabled) {
    return (
      <div className="stack">
        <p>On. Signing in asks for a code from your authenticator app, or one of your recovery codes.</p>
        <FormRow label="Code to turn it off" id="totp-code">{code_field}</FormRow>
        <div><button className="danger" onClick={() => void turn_off()}>Turn off</button></div>
        <p className="tone-bad small" role="alert">{message}</p>
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="muted">Off. A second factor asks for a code from your phone after the password.</p>
      {setup === null
        ? <div><button className="accent solid" onClick={() => void client.start_totp().then(set_setup)}>Set up</button></div>
        : <>
          <p>Add this key to your authenticator app (such as Aegis, 2FAS or a password manager), or open the link on the phone that has it:</p>
          <pre className="output secret-once">{setup.secret.match(/.{1,4}/g)!.join(" ")}</pre>
          <p><a href={setup.uri}>Open in an authenticator app</a></p>
          <FormRow label="Code it shows now" id="totp-code">{code_field}</FormRow>
          <div><button className="accent solid" onClick={() => void confirm()}>Confirm</button></div>
          <p className="tone-bad small" role="alert">{message}</p>
        </>}
    </div>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function SessionsPanel({ client }: { client: AccountsClient }) {
  const sessions = use_resource(client.sessions, [client]);
  const refresh = () => sessions.reload(true);
  const others = (sessions.data ?? []).filter((session) => !session.current).length;
  return (
    <div className="stack">
      <Loaded resource={sessions} lines={2}>{(rows) => (
        <DataTable<AccountSession> rows={rows} row_key={(session) => session.id} caption="Sessions" columns={[
          { label: "Device", cell: (session) => <>{session.label}{session.current && <span className="muted small"> (this one)</span>}</> },
          { label: "Signed in", cell: (session) => <span title={stamp(session.created_epoch)}>{age(session.created_epoch)}</span> },
          { label: "Last seen", cell: (session) => <Age epoch={session.last_seen_epoch} /> },
          { label: "Ends", cell: (session) => session_end_text(session) },
          {
            id: "actions", label: "", class: "actions-cell", cell: (session) => !session.current && (
              <button onClick={() => void client.close_session(session.id).then(refresh)}>Sign out</button>
            ),
          },
        ]} />
      )}</Loaded>
      {others > 0 && <div><button className="danger" onClick={() => void client.close_other_sessions().then(refresh)}>Sign out everywhere else</button></div>}
    </div>
  );
}

function session_end_text(session: AccountSession): string {
  if (session.expires_epoch !== null) return stamp(session.expires_epoch);
  return session.remember ? "when signed out" : "when the browser closes";
}

// ── Tokens ───────────────────────────────────────────────────────────────────

function OwnTokensPanel({ client }: { client: AccountsClient }) {
  const tokens = use_resource(client.own_tokens, [client]);
  const refresh = () => void tokens.reload(true);
  return (
    <div className="stack">
      <p className="muted small">A token acts as you for a device or script, sent as Authorization: Bearer &lt;token&gt;. Phones and desktop apps get one when they sign in.</p>
      <div><button onClick={() => token_dialog(client, refresh)}>Create token</button></div>
      <Loaded resource={tokens} lines={2}>{(rows) => <TokensTable tokens={rows} revoke={(token) => client.delete_own_token(token.id)} refresh={refresh} />}</Loaded>
    </div>
  );
}

function TokensTable({ tokens, show_owner = false, revoke, refresh }: { tokens: AccountToken[]; show_owner?: boolean; revoke: (token: AccountToken) => Promise<void>; refresh: () => void }) {
  if (tokens.length === 0) return <Empty title="No tokens." />;
  return (
    <DataTable<AccountToken> rows={tokens} row_key={(token) => token.id} caption="Tokens" columns={[
      { label: "Name", cell: (token) => <>{token.name}{token.read_only && <> <Chip>read only</Chip></>}</> },
      ...(show_owner ? [{ label: "Owner", cell: (token: AccountToken) => token.owner }] : []),
      { label: "Created", cell: (token) => <span title={stamp(token.created_epoch)}>{age(token.created_epoch)}</span> },
      { label: "Last used", cell: (token) => token.last_used_epoch ? <Age epoch={token.last_used_epoch} /> : <span className="muted">never</span> },
      {
        id: "actions", label: "", class: "actions-cell", cell: (token) => (
          <button className="danger" onClick={() => confirm_dialog({
            title: `Revoke ${token.name}?`,
            message: "Whatever uses it is refused from now on, and a device using it has to sign in again.",
            confirm_label: "Revoke",
            danger: true,
            run: async () => {
              await revoke(token);
              refresh();
            },
          })}>Revoke</button>
        ),
      },
    ]} />
  );
}

function token_dialog(client: AccountsClient, refresh: () => void): void {
  open_dialog((close) => <TokenDialog client={client} refresh={refresh} close={close} />);
}

function TokenDialog({ client, refresh, close }: { client: AccountsClient; refresh: () => void; close: () => void }) {
  const [name, set_name] = useState("");
  const [read_only, set_read_only] = useState(true);
  const [message, set_message] = useState("");

  async function create(): Promise<void> {
    try {
      const { token } = await client.create_token(name, read_only);
      close();
      refresh();
      show_once("Your new token", "Copy it now: the server keeps only a fingerprint of it and cannot show it again.", [token]);
    } catch (error) {
      set_message(refusal_of(error));
    }
  }

  return (
    <Dialog title="Create a token" on_close={close} buttons={<>
      <button onClick={close}>Cancel</button>
      <button className="accent solid" onClick={() => void create()}>Create</button>
    </>}>
      <div className="form-rows">
        <FormRow label="Name" id="token-name">
          <input id="token-name" type="text" placeholder="such as what will use it" autoFocus value={name} onChange={(event) => set_name(event.currentTarget.value)} />
        </FormRow>
        <label className="check">
          <input type="checkbox" checked={read_only} onChange={(event) => set_read_only(event.currentTarget.checked)} /> Read only
        </label>
        <p className="tone-bad small" role="alert">{message}</p>
      </div>
    </Dialog>
  );
}

// ── Users ────────────────────────────────────────────────────────────────────

interface UsersViewProps extends AccessWords {
  client: AccountsClient;
  // Who is signed in, so they are marked and cannot remove themselves.
  me: Me;
  access_editor?: AccessEditor;
}

export function UsersView({ client, me, access_editor, ...words }: UsersViewProps) {
  const admin = me.roles[me.roles.length - 1];
  const users = use_resource(client.users, [client]);
  const tokens = use_resource(client.all_tokens, [client]);
  const refresh = () => {
    void users.reload(true);
    void tokens.reload(true);
  };
  const editing = { client, me, words, access_editor, refresh };

  if (me.role !== admin) {
    return <div className="page"><PageHeading title="Users" /><Empty title={`Only ${with_article(admin ?? "admin")} manages users.`} /></div>;
  }
  return (
    <div className="page">
      <PageHeading title="Users" actions={<button className="accent solid" onClick={() => user_dialog(null, editing)}>Add user</button>} />
      <Section title="Who can sign in">
        <Loaded resource={users} lines={4}>{(rows) => <UsersTable users={rows} editing={editing} />}</Loaded>
      </Section>
      <Section title="Tokens">
        <Loaded resource={tokens} lines={2}>{(rows) => <TokensTable tokens={rows} show_owner revoke={(token) => client.delete_token(token.id)} refresh={refresh} />}</Loaded>
      </Section>
    </div>
  );
}

// The same for the settings page: everyone who can sign in, with Add user, and everyone's tokens, each a section for
// an admin; anyone else gets none, so the page shows them nothing.
export function users_settings({ client, me, access_editor, ...words }: UsersViewProps): SettingsSection[] {
  if (me.role !== me.roles[me.roles.length - 1]) return [];
  return [
    { id: "users", heading: "Users", hint: "Who can sign in, with their role and access. Changing a user's role, access or password signs them out everywhere.", content: <UsersSettingsList client={client} me={me} access_editor={access_editor} {...words} /> },
    { id: "tokens", heading: "Tokens", hint: "Every user's tokens, for devices and scripts.", content: <TokensSettingsList client={client} /> },
  ];
}

function UsersSettingsList({ client, me, access_editor, ...words }: UsersViewProps) {
  const users = use_resource(client.users, [client]);
  const editing = { client, me, words, access_editor, refresh: () => void users.reload(true) };
  return (
    <div className="stack tight">
      <Loaded resource={users} lines={4}>{(rows) => <UsersTable users={rows} editing={editing} />}</Loaded>
      <div><button className="accent solid" onClick={() => user_dialog(null, editing)}>Add user</button></div>
    </div>
  );
}

function TokensSettingsList({ client }: { client: AccountsClient }) {
  const tokens = use_resource(client.all_tokens, [client]);
  return <Loaded resource={tokens} lines={2}>{(rows) => <TokensTable tokens={rows} show_owner revoke={(token) => client.delete_token(token.id)} refresh={() => void tokens.reload(true)} />}</Loaded>;
}

interface Editing {
  client: AccountsClient;
  me: Me;
  words: AccessWords;
  access_editor?: AccessEditor;
  refresh: () => void;
}

function UsersTable({ users, editing }: { users: AccountUser[]; editing: Editing }) {
  const { client, me, words, refresh } = editing;
  const access_text = words.access_text ?? default_access_text;
  return (
    <DataTable<AccountUser> rows={users} row_key={(user) => user.name} caption="Users" columns={[
      { label: "Name", cell: (user) => <><strong>{user.name}</strong>{user.name === me.name && <span className="muted small"> (you)</span>}</> },
      { label: "Role", cell: (user) => <Chip title={words.role_text?.[user.role]}>{user.role}</Chip> },
      { label: "Access", cell: (user) => access_text(user.access) },
      { label: "Second factor", cell: (user) => user.totp_enabled ? "on" : <span className="muted">off</span> },
      {
        label: "Sign in", cell: (user) => user.source === "declared"
          ? <Chip title="Its password is in the accounts file this server is set up with">declared</Chip>
          : user.has_password ? "password" : <span className="muted">single sign-on only</span>,
      },
      {
        id: "actions", label: "", class: "actions-cell", cell: (user) => (
          <span className="row-actions">
            {user.source === "page" && <button onClick={() => user_dialog(user, editing)}>Edit</button>}
            {user.name !== me.name && <button onClick={() => void client.sign_user_out(user.name).then(() => toast(`${user.name} was signed out everywhere.`))}>Sign out</button>}
            {user.totp_enabled && <button onClick={() => reset_totp(client, user, refresh)}>Reset second factor</button>}
            {user.source === "page" && user.name !== me.name && <button className="danger" onClick={() => remove_user(client, user, refresh)}>Remove</button>}
          </span>
        ),
      },
    ]} />
  );
}

// Adds a user, or edits one when given; a password left empty on an edit stays as it was.
function user_dialog(user: AccountUser | null, editing: Editing): void {
  open_dialog((close) => <UserDialog user={user} editing={editing} close={close} />);
}

function UserDialog({ user, editing, close }: { user: AccountUser | null; editing: Editing; close: () => void }) {
  const { client, me, words, access_editor: AccessPicker, refresh } = editing;
  const [name, set_name] = useState(user?.name ?? "");
  const [role, set_role] = useState(user?.role ?? me.roles[0] ?? "");
  const [access, set_access] = useState<unknown>(user?.access ?? null);
  const [password, set_password] = useState("");
  const [message, set_message] = useState("");
  const [busy, set_busy] = useState(false);

  async function save(): Promise<void> {
    const fields = { name: name.trim(), role, access, password };
    set_busy(true);
    try {
      if (user) await client.update_user(user.name, fields);
      else await client.create_user(fields);
      toast(user ? `${user.name} saved; they were signed out everywhere.` : `${fields.name} added.`, { tone: "good" });
      close();
      refresh();
    } catch (error) {
      set_message(refusal_of(error));
      set_busy(false);
    }
  }

  return (
    <Dialog title={user ? `Edit ${user.name}` : "Add a user"} on_close={close} buttons={<>
      <button onClick={close}>Cancel</button>
      <button className="accent solid" disabled={busy} onClick={() => void save()}>{user ? "Save" : "Add user"}</button>
    </>}>
      <div className="form-rows">
        <FormRow label="Name" id="user-name" hint="Lowercase letters, digits, '.', '_' or '-'. Single sign-on matches it against the provider's user name.">
          <input id="user-name" type="text" value={name} readOnly={user !== null} autoComplete="off" autoCapitalize="none" autoFocus={user === null} onChange={(event) => set_name(event.currentTarget.value)} />
        </FormRow>
        <FormRow label="Role" id="user-role" hint={words.role_text?.[role]}>
          <select id="user-role" value={role} onChange={(event) => set_role(event.currentTarget.value)}>
            {me.roles.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </FormRow>
        {AccessPicker && <FormRow label="Access" id="user-access"><AccessPicker value={access} on_change={set_access} /></FormRow>}
        <FormRow label="Password" id="user-password">
          <input id="user-password" type="password" autoComplete="new-password" placeholder={user ? "leave empty to keep it" : "at least 12 characters, or empty for single sign-on only"} value={password} onChange={(event) => set_password(event.currentTarget.value)} />
        </FormRow>
        <p className="tone-bad small" role="alert">{message}</p>
      </div>
    </Dialog>
  );
}

function remove_user(client: AccountsClient, user: AccountUser, refresh: () => void): void {
  confirm_dialog({
    title: `Remove ${user.name}?`,
    message: "They are signed out at once, their tokens stop working, and they can no longer sign in.",
    confirm_label: "Remove user",
    busy_label: "Removing…",
    danger: true,
    type_to_confirm: user.name,
    run: async () => {
      await client.delete_user(user.name);
      toast(`${user.name} removed.`, { tone: "warn" });
      refresh();
    },
  });
}

function reset_totp(client: AccountsClient, user: AccountUser, refresh: () => void): void {
  confirm_dialog({
    title: `Reset ${user.name}'s second factor?`,
    message: "Their authenticator app and recovery codes stop working, and they sign in with the password alone until they set it up again. Do this when they have lost their phone.",
    confirm_label: "Reset second factor",
    danger: true,
    run: async () => {
      await client.reset_totp(user.name);
      toast(`${user.name}'s second factor was reset.`, { tone: "warn" });
      refresh();
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// A secret the server hands out once, with a button to copy it.
export function show_once(title: string, note: ReactNode, lines: string[]): void {
  const text = lines.join("\n");
  open_dialog((close) => (
    <Dialog title={title} on_close={close} buttons={<>
      <button onClick={() => void navigator.clipboard?.writeText(text).then(() => toast("Copied."))}>Copy</button>
      <button className="accent solid" onClick={close}>I have saved it</button>
    </>}>
      <div><p>{note}</p><pre className="output secret-once">{text}</pre></div>
    </Dialog>
  ));
}

// The server's words for a refusal, passing on anything else, such as a lapsed session.
function refusal_of(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  return error.message;
}

function with_article(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}
