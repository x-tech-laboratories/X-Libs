// Asking the user about a server whose https certificate this device does not accept, such as a home server's
// self-signed one: the dialog that shows the certificate and what is wrong with it and offers to trust it anyway, the
// ways it opens by itself (a failed fetch, a failing sync), and the settings rows that list and forget trusted ones.

import { useEffect, useRef, useState } from "react";
import { certificate_problem_text, is_routine_problem, type CertificateCheck, type CertificateClient, type CertificateDetails } from "../../certificate_protocol.ts";
import type { SyncDeviceClient } from "../../sync_protocol.ts";
import { describe_error } from "../errors.ts";
import { Dialog, open_dialog } from "./dialog.tsx";
import { Facts, SettingRow } from "./layout.tsx";
import { toast } from "./toasts.tsx";

// ── Dialog ───────────────────────────────────────────────────────────────────

interface CertificateDialogProps {
  check: CertificateCheck;
  // Trusts the certificate; a throw keeps the dialog open with the message.
  on_trust: () => Promise<void>;
  on_close: (trusted: boolean) => void;
}

function CertificateFacts({ certificate }: { certificate: CertificateDetails }) {
  return (
    <Facts layout="rows" rows={[
      ["Issued to", certificate.subject],
      ["Issued by", certificate.subject === certificate.issuer ? `${certificate.issuer} (itself)` : certificate.issuer],
      certificate.alt_names.length > 0 && ["Names it covers", certificate.alt_names.join(", ")],
      ["Valid", `${new Date(certificate.valid_from).toLocaleDateString()} to ${new Date(certificate.valid_to).toLocaleDateString()}`],
      ["SHA-256 fingerprint", certificate.fingerprint, "path"],
      ["Serial number", certificate.serial_number, "path"],
    ]} />
  );
}

// Shows what is wrong and the certificate itself, so the user can check the fingerprint before trusting it.
export function CertificateDialog({ check, on_trust, on_close }: CertificateDialogProps) {
  const [error, set_error] = useState("");
  const [busy, set_busy] = useState(false);
  const routine = is_routine_problem(check.problems);
  const [leaf, ...vouchers] = check.chain;

  async function trust(): Promise<void> {
    set_busy(true);
    set_error("");
    try {
      await on_trust();
      on_close(true);
    } catch (caught) {
      set_error(describe_error(caught));
      set_busy(false);
    }
  }

  return (
    <Dialog
      title={`${check.host} has a certificate this device does not trust`}
      subtitle={check.origin}
      wide
      on_close={() => { if (!busy) on_close(false); }}
      buttons={<>
        <button type="button" autoFocus disabled={busy} onClick={() => on_close(false)}>Don't connect</button>
        <button type="button" className={routine ? "accent solid" : "danger solid"} disabled={busy} onClick={() => void trust()}>
          {busy ? "Trusting…" : "Trust this certificate"}
        </button>
      </>}
    >
      <ul>{check.problems.map((problem) => <li key={problem}>{certificate_problem_text[problem]}</li>)}</ul>
      <p className="setting-hint">
        {routine
          ? "That is expected for a server you set up yourself. Trust it only if the fingerprint below matches the one on your server; this device then accepts this exact certificate for this host, and asks again if it ever changes."
          : "This can also mean someone is pretending to be the server. Trust it only if you know why the certificate is like this and the fingerprint matches the one on your server."}
      </p>
      {leaf && <CertificateFacts certificate={leaf} />}
      <details>
        <summary>Show the certificate{vouchers.length > 0 ? `s (${check.chain.length})` : ""}</summary>
        {vouchers.map((certificate) => <CertificateFacts key={certificate.fingerprint} certificate={certificate} />)}
        <pre className="output">{check.chain.map((certificate) => certificate.pem).join("\n")}</pre>
        <p className="setting-hint">TLS said: {check.reason}</p>
      </details>
      {error && <p className="tone-bad small" role="alert">{error}</p>}
    </Dialog>
  );
}

// ── Asking ───────────────────────────────────────────────────────────────────

// Certificates the user turned down, so the same one is not offered again until the page reloads.
const declined = new Set<string>();

// Opens the dialog over the page; resolves true once the certificate is trusted, false when the user declines.
export function ask_to_trust_certificate(check: CertificateCheck, certificates: CertificateClient): Promise<boolean> {
  return new Promise((resolve) => {
    open_dialog((close) => (
      <CertificateDialog
        check={check}
        on_trust={async () => { await certificates.trust_certificate(check.origin, check.chain[0]!.fingerprint); }}
        on_close={(trusted) => {
          if (!trusted) declined.add(check.chain[0]!.fingerprint);
          close();
          resolve(trusted);
        }}
      />
    ));
  });
}

// Checks the address's certificate and asks about it when it is the reason a request failed; true once it is trusted.
export async function offer_certificate_trust(url: string, certificates: CertificateClient): Promise<boolean> {
  const check = await certificates.check_certificate(url).catch(() => null);
  if (!check || check.trusted || declined.has(check.chain[0]!.fingerprint)) return false;
  return ask_to_trust_certificate(check, certificates);
}

// A fetch that, when a request fails over the server's certificate, asks the user and tries once more if they trust it.
export function with_certificate_prompt(send: typeof fetch, certificates: CertificateClient): typeof fetch {
  return async (input, init) => {
    try {
      return await send(input, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const url = input instanceof Request ? input.url : String(input);
      if (await offer_certificate_trust(url, certificates)) return send(input, init);
      throw error;
    }
  };
}

// ── Sync ─────────────────────────────────────────────────────────────────────

const SYNC_CHECK_MS = 5000;

// Placed once in the app: whenever sync fails, checks the server's certificate and asks about it, then syncs again if trusted.
export function SyncCertificatePrompt({ device, certificates, subscribe }: { device: SyncDeviceClient; certificates: CertificateClient; subscribe?: (listener: () => void) => () => void }) {
  const looked_at = useRef("");

  useEffect(() => {
    let checking = false;
    const look = async () => {
      if (checking) return;
      checking = true;
      try {
        // Each failure is looked at once, and again only after sync recovers or fails differently.
        const status = await device.get_sync_status();
        const failing = (status.state === "offline" || status.state === "failed") && status.server_url !== "";
        const key = failing ? `${status.server_url} ${status.error}` : "";
        if (key === looked_at.current) return;
        looked_at.current = key;
        if (failing && await offer_certificate_trust(status.server_url, certificates)) await device.sync_now();
      } finally {
        checking = false;
      }
    };
    void look();
    const timer = setInterval(() => void look(), SYNC_CHECK_MS);
    const stop = subscribe?.(() => void look());
    return () => {
      clearInterval(timer);
      stop?.();
    };
  }, [device, certificates, subscribe]);

  return null;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// A row for each certificate the user trusted, with the button that forgets it.
export function TrustedCertificates({ certificates }: { certificates: CertificateClient }) {
  const [trusted, set_trusted] = useState<Awaited<ReturnType<CertificateClient["list_trusted_certificates"]>> | null>(null);

  useEffect(() => void certificates.list_trusted_certificates().then(set_trusted), [certificates]);

  if (!trusted) return null;
  if (trusted.length === 0) return <SettingRow label="Trusted certificates" hint="None. When a server's certificate is not trusted, such as a self-signed one, this device asks before connecting.">{null}</SettingRow>;

  return <>{trusted.map((entry) => (
    <SettingRow key={entry.host} label={`Trusting ${entry.host}`} hint={`${entry.subject} · ${entry.fingerprint}`}>
      <button type="button" onClick={() => void certificates.forget_certificate(entry.host).then((list) => {
        set_trusted(list);
        toast(`${entry.host}'s certificate is no longer trusted.`);
      })}>Forget</button>
    </SettingRow>
  ))}</>;
}
