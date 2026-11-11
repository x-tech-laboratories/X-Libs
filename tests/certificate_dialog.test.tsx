// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CertificateCheck, CertificateClient } from "../src/certificate_protocol.ts";
import { ask_to_trust_certificate, offer_certificate_trust, with_certificate_prompt } from "../src/web/react/certificates.tsx";
import { Dialogs } from "../src/web/react/dialog.tsx";

afterEach(cleanup);

function check_of(fingerprint: string, problems: CertificateCheck["problems"] = ["self_signed"]): CertificateCheck {
  const certificate = { subject: "CN=nas.lan", issuer: "CN=nas.lan", alt_names: ["DNS:nas.lan"], valid_from: "2026-01-01T00:00:00Z", valid_to: "2027-01-01T00:00:00Z", fingerprint, serial_number: "01", pem: "-----BEGIN CERTIFICATE-----" };
  return { origin: "https://nas.lan:8443", host: "nas.lan", problems, reason: "DEPTH_ZERO_SELF_SIGNED_CERT", chain: [certificate], trusted: false };
}

function client_for(check: CertificateCheck | null): CertificateClient {
  return {
    check_certificate: vi.fn(async () => check),
    trust_certificate: vi.fn(async () => []),
    list_trusted_certificates: vi.fn(async () => []),
    forget_certificate: vi.fn(async () => []),
  };
}

describe("certificate dialog", () => {
  it("shows what is wrong and the fingerprint, and trusts that certificate when asked", async () => {
    render(<Dialogs />);
    const certificates = client_for(null);
    let answer: Promise<boolean> = Promise.resolve(false);

    act(() => { answer = ask_to_trust_certificate(check_of("AB:CD", ["self_signed", "wrong_host"]), certificates); });

    expect(screen.getByText(/self-signed/)).toBeTruthy();
    expect(screen.getByText(/different name/)).toBeTruthy();
    expect(screen.getByText("AB:CD")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trust this certificate" }).className).toBe("danger solid");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Trust this certificate" })));
    expect(await answer).toBe(true);
    expect(certificates.trust_certificate).toHaveBeenCalledWith("https://nas.lan:8443", "AB:CD");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("does not offer a declined certificate again", async () => {
    render(<Dialogs />);
    const certificates = client_for(check_of("11:22"));
    let answer: Promise<boolean> = Promise.resolve(true);

    await act(async () => { answer = offer_certificate_trust("https://nas.lan:8443/", certificates); });
    fireEvent.click(screen.getByRole("button", { name: "Don't connect" }));

    expect(await answer).toBe(false);
    expect(await offer_certificate_trust("https://nas.lan:8443/", certificates)).toBe(false);
    expect(document.querySelector("dialog")).toBeNull();
  });
});

describe("with_certificate_prompt", () => {
  it("tries a failed request once more after the certificate is trusted", async () => {
    render(<Dialogs />);
    const send = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(new Response("hello"));
    const certificates = client_for(check_of("33:44"));
    let answer: Promise<Response> | null = null;

    await act(async () => { answer = with_certificate_prompt(send, certificates)("https://nas.lan:8443/api"); });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Trust this certificate" })));

    expect(await (await answer!).text()).toBe("hello");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("hands on the failure when the certificate is not the reason", async () => {
    const send = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(with_certificate_prompt(send, client_for(null))("https://example.org/")).rejects.toThrow("fetch failed");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
