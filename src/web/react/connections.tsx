// The Connections section of a desktop or phone app's settings, like Deluge's connection manager: every daemon the app
// can talk to, the one it talks to now marked Connected, Connect to switch, Rename and Remove for daemons on other
// hosts, and a form to add one by its address, name and password (and the code when asked). It pairs with `connections`.

import { useEffect, useId, useState, type FormEvent } from "react";
import type { CertificateClient } from "../../certificate_protocol.ts";
import { connection_address, type ConnectionClient, type ConnectionSummary, type ConnectionsView } from "../../connection_protocol.ts";
import { asks_for_code } from "../../connection_protocol.ts";
import { describe_call_error } from "../errors.ts";
import { StatusPill } from "./badges.tsx";
import { offer_certificate_trust } from "./certificates.tsx";
import { confirm_dialog, Dialog, open_dialog } from "./dialog.tsx";
import { FormRow, SettingRow } from "./layout.tsx";
import { toast } from "./toasts.tsx";

export interface ConnectionSettingsProps {
  // The calls as the page reaches them, such as through Electron's preload or a phone's bridge.
  client: ConnectionClient;
  // Reads the list again whenever it calls back; returns how to stop.
  subscribe?: (listener: () => void) => () => void;
  // An example daemon address.
  placeholder?: string;
  // Asks to trust a daemon's certificate this device refuses, such as a self-signed one, and adds it again once trusted.
  certificates?: CertificateClient;
}

function fail(error: unknown): void {
  toast(describe_call_error(error), { tone: "bad" });
}

export function ConnectionSettings({ client, subscribe, placeholder = "https://home.example.org", certificates }: ConnectionSettingsProps) {
  const [view, set_view] = useState<ConnectionsView | null>(null);
  const [address, set_address] = useState("");
  const [name, set_name] = useState("");
  const [password, set_password] = useState("");
  const [code, set_code] = useState("");
  const [asks_code, set_asks_code] = useState(false);
  const [label, set_label] = useState("");
  const [busy, set_busy] = useState(false);

  useEffect(() => {
    const read = () => void client.list_connections().then(set_view, fail);
    read();
    return subscribe?.(read);
  }, [client, subscribe]);

  async function add(): Promise<void> {
    set_busy(true);
    try {
      set_view(await client.add_connection(address, { name, password, ...(asks_code ? { code } : {}) }, label));
      toast(`Added ${label.trim() || address.trim()}.`, { tone: "good" });
      set_address("");
      set_name("");
      set_password("");
      set_code("");
      set_label("");
      set_asks_code(false);
    } catch (error) {
      if (asks_for_code(error) && !asks_code) set_asks_code(true);
      else if (certificates && await trust_offered(address, certificates)) return void add();
      else fail(error);
    } finally {
      set_busy(false);
    }
  }

  function choose(connection: ConnectionSummary): void {
    void client.choose_connection(connection.id).then((next) => {
      set_view(next);
      toast(`Connected to ${connection.name}.`, { tone: "good" });
    }, fail);
  }

  function remove(connection: ConnectionSummary): void {
    confirm_dialog({
      title: `Remove ${connection.name}?`,
      message: `This device forgets the daemon at ${connection.address} and gives back its sign-in. The daemon and its data stay as they are.`,
      confirm_label: "Remove",
      danger: true,
      run: () => client.remove_connection(connection.id).then(set_view, fail),
    });
  }

  function rename(connection: ConnectionSummary): void {
    open_dialog((close) => <RenameDialog connection={connection} on_close={close} on_rename={(next) => client.rename_connection(connection.id, next).then(set_view)} />);
  }

  if (!view) return null;

  return (
    <>
      {view.connections.length === 0 && <SettingRow label="No daemon yet" hint="Add the daemon this app connects to below.">{null}</SettingRow>}
      {view.connections.map((connection) => (
        <SettingRow key={connection.id} label={connection.name} hint={connection.kind === "local" ? "The daemon on this computer" : `${connection.user} at ${connection.address}`}>
          {connection.id === view.current
            ? <StatusPill tone="good" label="Connected" />
            : <button type="button" onClick={() => choose(connection)}>Connect</button>}
          {connection.kind === "remote" && <>
            <button type="button" onClick={() => rename(connection)}>Rename</button>
            <button type="button" className="danger" onClick={() => remove(connection)}>Remove</button>
          </>}
        </SettingRow>
      ))}
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void add(); }}>
        <SettingRow label="Daemon address" as_label>
          <input type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder={placeholder} value={address} onChange={(event) => set_address(event.currentTarget.value)} />
        </SettingRow>
        <SettingRow label="User name" as_label>
          <input type="text" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={name} onChange={(event) => set_name(event.currentTarget.value)} />
        </SettingRow>
        <SettingRow label="Password" as_label>
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(event) => set_password(event.currentTarget.value)} />
        </SettingRow>
        {asks_code && (
          <SettingRow label="Code from your authenticator app, or a recovery code" as_label>
            <input type="text" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" autoFocus value={code} onChange={(event) => set_code(event.currentTarget.value)} />
          </SettingRow>
        )}
        <SettingRow label="Name" hint="Its host unless you name it." as_label>
          <input type="text" value={label} onChange={(event) => set_label(event.currentTarget.value)} />
        </SettingRow>
        <SettingRow label="Add a daemon" hint="Signs this device in to it with a token of its own.">
          <button type="submit" disabled={busy || address.trim() === "" || name.trim() === ""}>Add daemon</button>
        </SettingRow>
      </form>
    </>
  );
}

// Offers to trust the daemon's certificate when it is one this device refuses; an address that does not parse has none to offer.
async function trust_offered(typed: string, certificates: CertificateClient): Promise<boolean> {
  let address: string;
  try {
    address = connection_address(typed);
  } catch {
    return false;
  }
  return offer_certificate_trust(address, certificates);
}

function RenameDialog({ connection, on_close, on_rename }: { connection: ConnectionSummary; on_close: () => void; on_rename: (name: string) => Promise<unknown> }) {
  const [name, set_name] = useState(connection.name);
  const id = useId();

  function submit(): void {
    void on_rename(name).then(on_close, fail);
  }

  return (
    <Dialog title={`Rename ${connection.name}`} on_close={on_close} form={{ on_submit: submit, submit_label: "Rename", submit_disabled: name.trim() === "" }} buttons={<button type="button" onClick={on_close}>Cancel</button>}>
      <div className="form-rows">
        <FormRow label="Name" id={id}>
          <input id={id} type="text" autoFocus value={name} onChange={(event) => set_name(event.currentTarget.value)} />
        </FormRow>
      </div>
    </Dialog>
  );
}
