// The base app's page: the Shell around every section, the router between them, Settings and Your account, and in a
// browser, signing in to the server first. render_app starts it on whichever host it runs.

// ── Imports ──────────────────────────────────────────────────────────────────

import "@x-tech-laboratories/halon/halon-tokens.css";
import "@x-tech-laboratories/halon/halon.css";
import { Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { create_accounts_client, type Me } from "../../web/accounts.ts";
import { AccountView, UsersView } from "../../web/react/accounts.tsx";
import { SyncCertificatePrompt } from "../../web/react/certificates.tsx";
import { PageHeading } from "../../web/react/layout.tsx";
import { Shell, use_route, type ShellSection } from "../../web/react/shell.tsx";
import { SignInForm, use_account } from "../../web/react/sign_in.tsx";
import { SyncButton } from "../../web/react/sync_settings.tsx";
import { theme_choice } from "../../web/theme.ts";
import type { App } from "../define.ts";
import type { PageApi } from "../protocol.ts";
import { desktop_api, is_android, is_desktop, web_api } from "./hosts.ts";
import { data_watch, page, set_page_api } from "./page.ts";
import { SettingsView, type AppPages } from "./settings_page.tsx";

export type { AppPage, AppPages, PageSettingsProps } from "./settings_page.tsx";

// ── Pages ────────────────────────────────────────────────────────────────────

// Relative, so a server behind a proxy under a folder keeps it.
const accounts = create_accounts_client({ base: "api" });

// Signed in, in a browser: who, and how to sign out.
interface Account {
  me: Me;
  refresh: () => Promise<void>;
  sign_out: () => Promise<void>;
}

// The highest role, which manages users and the server's backups.
function is_admin(me: Me): boolean {
  return me.role === me.roles[me.roles.length - 1];
}

function AccountPage({ account }: { account: Account }) {
  return (
    <>
      <PageHeading title="Your account" subtitle={account.me.name} />
      <AccountView client={accounts} on_change={() => void account.refresh()} />
      {is_admin(account.me) && <UsersView client={accounts} me={account.me} />}
    </>
  );
}

// Sync on a device that syncs, above the Shell's own theme, account and Settings rows.
function SidebarFoot() {
  const { device } = page();
  return device ? <SyncButton device={device} subscribe={(listener) => data_watch.subscribe(listener)} on_open_settings={() => (window.location.hash = "/settings")} /> : null;
}

function Pages({ pages, account }: { pages: AppPages; account: Account | null }) {
  const { app } = pages;
  const route = use_route();
  const [section = pages.pages[0]?.id ?? "settings", ...rest] = route.parts;
  const shown = pages.pages.find((candidate) => candidate.id === section);
  const is_account = account !== null && section === "account";
  const label = shown?.label ?? (is_account ? "Your account" : "Settings");
  const view_key = route.parts.join("/");

  useEffect(() => {
    document.title = `${label} · ${app.name}`;
  }, [label, app.name]);

  const sections: ShellSection[] = pages.pages.map((each) => ({ id: each.id, label: each.label, href: `#/${each.id}` }));
  const view = shown ? shown.view(rest) : is_account ? <AccountPage account={account} /> : <SettingsView pages={pages} is_admin={account === null || is_admin(account.me)} />;
  return (
    <Shell
      brand={app.name}
      brand_icon={pages.brand_icon ?? "icon.svg"}
      sections={sections}
      active={section}
      theme={theme_choice(`${app.id}-theme`)}
      view_key={view_key}
      user={account ? account.me.name : undefined}
      user_href={account ? "#/account" : undefined}
      on_logout={account ? () => void account.sign_out() : undefined}
      sidebar_foot={<SidebarFoot />}
      settings={{ href: "#/settings" }}
    >
      <Fragment key={view_key}>{view}</Fragment>
    </Shell>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

// A browser reaches the server's data, so it signs in; the desktop and phone apps keep their own and sign in only to sync.
function BrowserApp({ pages }: { pages: AppPages }) {
  const { account, refresh, sign_out } = use_account(accounts);
  if (account.state === "checking") return null;
  if (account.state === "signed_out") return <SignInForm client={accounts} title={pages.app.name} icon={pages.brand_icon ?? "icon.svg"} on_signed_in={refresh} />;
  return <Pages pages={pages} account={{ me: account.me, refresh, sign_out }} />;
}

// A device that syncs asks to trust its server's certificate whenever sync fails over it.
function DeviceApp({ pages }: { pages: AppPages }) {
  const { certificates, device } = page();
  return <>
    {device && certificates && <SyncCertificatePrompt device={device} certificates={certificates} subscribe={(listener) => data_watch.subscribe(listener)} />}
    <Pages pages={pages} account={null} />
  </>;
}

export function AppView({ pages }: { pages: AppPages }) {
  return page().host === "web" ? <BrowserApp pages={pages} /> : <DeviceApp pages={pages} />;
}

// ── Start ────────────────────────────────────────────────────────────────────

// The phone's code loads only on the phone, so a browser never fetches SQLite.
async function host_api(app: App): Promise<PageApi> {
  if (is_desktop(app)) return desktop_api(app);
  if (is_android()) return (await import("./android.ts")).android_api(app);
  return web_api(app);
}

// Starts the page on whichever host it runs: the desktop app, the phone app or a browser.
export async function render_app(pages: AppPages & { app: App }, root: HTMLElement = document.getElementById("app")!): Promise<void> {
  const api = await host_api(pages.app);
  set_page_api(api);
  // A link the desktop app was opened with, or a tray row, opens its page.
  api.on_event?.("open", (route) => {
    if (typeof route === "string" && route.startsWith("#/")) location.hash = route;
  });
  createRoot(root).render(<AppView pages={pages} />);
}
