// The Sync section every app that syncs shows in its settings: this device and whether it is synced, each paired
// device with how it was last reached and a button to remove it, a pairing code to show to another device, and a field
// to enter one from another device. Paired copies merge value by value, the newest write winning, so nothing asks
// which copy to keep. It pairs with sync_peer, which runs wherever the app keeps its database.
// SyncButton is the same status as a sidebar row that syncs on a click.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { CertificateClient } from "../../certificate_protocol.ts";
import { format_device_id, type PeerListening, type PeerListeningClient, type PeerStatus, type SyncDeviceClient, type SyncStatus } from "../../sync_protocol.ts";
import { describe_error } from "../errors.ts";
import { StatusPill } from "./badges.tsx";
import { offer_certificate_trust } from "./certificates.tsx";
import { Switch } from "./controls.tsx";
import { confirm_dialog, text_dialog } from "./dialog.tsx";
import { SettingRow } from "./layout.tsx";
import { toast } from "./toasts.tsx";

export interface SyncSettingsProps {
  // The device's side as the page reaches it, such as through Electron's preload or a phone's bridge.
  device: SyncDeviceClient;
  // Reads the status again whenever it calls back, such as after a sync changed the data; returns how to stop.
  subscribe?: (listener: () => void) => () => void;
  // What the data is called, such as "tasks"; "data" unless set.
  data_name?: string;
  // More rows after the section, such as the switch that lets other devices connect.
  extra?: ReactNode;
  // Asks to review and trust the other device's self-signed certificate when pairing fails over it, then pairs again.
  certificates?: CertificateClient;
}

const tones = { off: "none", idle: "good", syncing: "info", offline: "warn", failed: "bad" } as const;
const state_text = { off: "Not paired with another device", idle: "Synced", syncing: "Syncing", offline: "Offline", failed: "Failed" } as const;

// The addresses a pairing code says its device answers at, or none when it is not a whole code; it checks nothing else.
function addresses_in_pairing_code(code: string): string[] {
  try {
    const text = code.replace(/\s+/g, "").replace(/^x-sync:/, "").replaceAll("-", "+").replaceAll("_", "/");
    const offer = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, "=")), (letter: string) => letter.charCodeAt(0)))) as { addresses?: unknown };
    return Array.isArray(offer.addresses) ? offer.addresses.filter((address): address is string => typeof address === "string") : [];
  } catch {
    return [];
  }
}

// Strips what Electron adds in front of an error that crossed from the main process.
function error_text(error: unknown): string {
  return describe_error(error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

function when_text(iso_time: string): string {
  return iso_time ? new Date(iso_time).toLocaleString() : "never";
}

function PeerRow({ peer, on_remove }: { peer: PeerStatus; on_remove: () => void }) {
  const reached = peer.addresses.length > 0 ? peer.addresses.join(", ") : "reaches this device";
  const hint = `${format_device_id(peer.device)} · ${reached} · last synced ${when_text(peer.last_synced_at)}${peer.error ? ` · ${peer.error}` : ""}`;
  return (
    <SettingRow label={peer.name} hint={hint}>
      <StatusPill tone={tones[peer.state]} busy={peer.state === "syncing"} label={state_text[peer.state]} />
      <button type="button" onClick={on_remove}>Remove</button>
    </SettingRow>
  );
}

export function SyncSettings({ device, subscribe, data_name = "data", extra, certificates }: SyncSettingsProps) {
  const [status, set_status] = useState<SyncStatus | null>(null);
  const [code, set_code] = useState("");
  const [busy, set_busy] = useState(false);

  useEffect(() => {
    const read = () => void device.get_sync_status().then(set_status);
    read();
    return subscribe?.(read);
  }, [device, subscribe]);

  async function show_code(): Promise<void> {
    try {
      const made = await device.create_pairing_code();
      text_dialog("Pairing code", `Enter this code on the other device before ${new Date(made.expires_at).toLocaleTimeString()}. It works once.\n\n${made.code}`);
    } catch (error) {
      toast(error_text(error), { tone: "bad" });
    }
  }

  // The first https address whose certificate the user trusts after reviewing it, if any.
  async function trusted_after_review(): Promise<boolean> {
    if (!certificates) return false;
    for (const address of addresses_in_pairing_code(code).filter((each) => each.startsWith("https:"))) {
      if (await offer_certificate_trust(address, certificates)) return true;
    }
    return false;
  }

  async function pair(event: FormEvent | null, is_retry = false): Promise<void> {
    event?.preventDefault();
    set_busy(true);
    try {
      set_status(await device.pair_device(code));
      set_code("");
      toast(`Paired. The ${data_name} on both devices are merged, the newest change to each winning.`, { tone: "good" });
    } catch (error) {
      if (!is_retry && (await trusted_after_review())) return void (await pair(null, true));
      toast(error_text(error), { tone: "bad" });
    } finally {
      set_busy(false);
    }
  }

  function remove(peer: PeerStatus): void {
    confirm_dialog({
      title: `Remove ${peer.name}?`,
      message: `${peer.name} stops syncing with this device and the others it is paired with. The ${data_name} on it stay as they are.`,
      confirm_label: "Remove",
      danger: true,
      run: async () => set_status(await device.remove_device(peer.device)),
    });
  }

  if (!status) return null;
  const label = `${state_text[status.state]}${status.error ? `: ${status.error}` : ""}`;

  return (
    <>
      <SettingRow label="Status" hint={`${status.pending_changes} changes waiting · last synced ${when_text(status.last_synced_at)}`}>
        <StatusPill tone={tones[status.state]} busy={status.state === "syncing"} label={label} />
        {status.peers.length > 0 && <button type="button" onClick={() => void device.sync_now().then(set_status)}>Sync now</button>}
      </SettingRow>
      <SettingRow label={`This device: ${status.name}`} hint={`${format_device_id(status.device)} · ${status.addresses.length > 0 ? status.addresses.join(", ") : "other devices cannot reach it; it reaches them"}`}>
        {status.addresses.length > 0 && <button type="button" onClick={() => void show_code()}>Show pairing code</button>}
      </SettingRow>
      {status.peers.map((peer) => <PeerRow key={peer.device} peer={peer} on_remove={() => remove(peer)} />)}
      <form onSubmit={(event) => void pair(event)}>
        <SettingRow label="Pair with a device" hint="Enter the pairing code the other device shows under Sync." as_label>
          <input type="text" autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="x-sync:…" value={code} onChange={(event) => set_code(event.currentTarget.value)} />
          <button type="submit" disabled={busy || code.trim() === ""}>Pair</button>
        </SettingRow>
      </form>
      {extra}
    </>
  );
}

// ── Listening ────────────────────────────────────────────────────────────────

// A desktop's "Let other devices connect" switch and its port, for the Sync section's extra rows.
export function PeerListeningSettings({ listening }: { listening: PeerListeningClient }) {
  const [state, set_state] = useState<PeerListening | null>(null);
  const [port, set_port] = useState("");

  useEffect(() => void listening.get_peer_listening().then((read) => (set_state(read), set_port(String(read.port)))), [listening]);

  async function change(on: boolean, typed = port): Promise<void> {
    try {
      const next = await listening.set_peer_listening(on, Number(typed));
      set_state(next);
      if (next.error) toast(`Other devices cannot connect: ${next.error}`, { tone: "bad" });
    } catch (error) {
      toast(error_text(error), { tone: "bad" });
    }
  }

  if (!state) return null;
  const reached = state.on && state.addresses.length > 0 ? `Paired devices reach this one at ${state.addresses.join(", ")}.` : "Lets paired devices on your networks reach this one over https, so they sync without a server between them.";
  // The other device asks to trust this one's self-signed certificate once; its fingerprint there should match this one.
  const hint = state.fingerprint ? `${reached} Its certificate's fingerprint is ${state.fingerprint}.` : reached;
  return (
    <>
      <SettingRow label="Let other devices connect" hint={state.error ? `The port could not be opened: ${state.error}` : hint} as_label>
        <Switch label="Let other devices connect" checked={state.on} on_change={(on) => change(on)} />
      </SettingRow>
      <SettingRow label="Port" hint="The port other devices connect to." as_label>
        <input type="number" min={1} max={65535} value={port} onChange={(event) => set_port(event.currentTarget.value)} onBlur={() => state.on && Number(port) !== state.port && void change(true)} />
      </SettingRow>
    </>
  );
}

// ── Sidebar button ───────────────────────────────────────────────────────────

const SYNC_STATUS_POLL_MS = 2000;

export interface SyncButtonProps {
  device: SyncDeviceClient;
  // Reads the status again whenever it calls back, besides every two seconds; returns how to stop.
  subscribe?: (listener: () => void) => () => void;
  // Opens the Sync settings, which a click does when sync failed or no device is paired.
  on_open_settings: () => void;
}

const button_text = { off: "Sync not set up", idle: "Synced", syncing: "Syncing…", offline: "Offline", failed: "Sync failed" } as const;

// Today's syncs show only the time; older ones show the day too.
function synced_at_text(iso_time: string): string {
  if (iso_time === "") return "Not synced yet";
  const time = new Date(iso_time);
  const is_today = time.toDateString() === new Date().toDateString();
  return `Last synced ${is_today ? time.toLocaleTimeString(undefined, { timeStyle: "short" }) : time.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`;
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? "line-icon spinning" : "line-icon"} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

// A sidebar row showing whether this device is synced and how many changes wait to go out; a click syncs now, or opens
// the settings when sync failed or no device is paired yet.
export function SyncButton({ device, subscribe, on_open_settings }: SyncButtonProps) {
  const [status, set_status] = useState<SyncStatus | null>(null);
  // Set while a sync asked for here runs, so the button spins before the next status arrives.
  const [syncing, set_syncing] = useState(false);

  useEffect(() => {
    const read = () => void device.get_sync_status().then(set_status, () => {});
    read();
    const timer = setInterval(read, SYNC_STATUS_POLL_MS);
    const stop = subscribe?.(read);
    return () => {
      clearInterval(timer);
      stop?.();
    };
  }, [device, subscribe]);

  if (!status) return null;
  const state = syncing ? "syncing" : status.state;
  const needs_user = state === "off" || state === "failed";

  function click(): void {
    if (needs_user) return on_open_settings();
    set_syncing(true);
    void device.sync_now().then(set_status, () => {}).finally(() => set_syncing(false));
  }

  const with_whom = status.peers.map((peer) => peer.name).join(", ");
  const title = state === "off" ? "Open the sync settings" : [synced_at_text(status.last_synced_at), status.error || `with ${with_whom}`].join("\n");
  return (
    <button type="button" className={needs_user ? "tree-row tone-bad" : "tree-row"} title={title} disabled={state === "syncing"} onClick={click}>
      <span className="tree-label">
        <SyncIcon spinning={state === "syncing"} />
        <span>{button_text[state]}</span>
      </span>
      {status.pending_changes > 0 && <span className="tree-extra">{status.pending_changes} pending</span>}
    </button>
  );
}
