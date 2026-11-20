// Helpers an app's tests share when they reach servers and repositories for real, on this machine alone: a free port
// on the loopback address, throwaway folders, a git checkout with one commit, and a certificate that signs itself for
// localhost, as a home server's often does. The checkout needs git and the certificate openssl on the PATH.

// ── Imports ──────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Ports and folders ────────────────────────────────────────────────────────

// A port nothing listens on, found by asking for any port on the loopback address.
export function free_port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

// A new empty folder under the system's temporary folder, its name starting with the one given.
export function temp_folder(name: string): string {
  return mkdtempSync(join(tmpdir(), `${name}-`));
}

// A throwaway git checkout on branch main with one commit holding a README, as a test's stand-in repository.
export function make_checkout(name = "checkout"): string {
  const folder = temp_folder(name);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", ...args], { cwd: folder, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(folder, "README.md"), "# Test\n");
  git("add", ".");
  git("commit", "-q", "-m", "chore: start");
  return folder;
}

// ── Certificates ─────────────────────────────────────────────────────────────

// A certificate that signs itself for localhost and 127.0.0.1, valid for a month, and its key, in a folder of their own.
export function self_signed_certificate(): { certificate_file: string; key_file: string } {
  const folder = temp_folder("certificate");
  const certificate_file = join(folder, "server.pem");
  const key_file = join(folder, "server.key");
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", key_file, "-out", certificate_file, "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  return { certificate_file, key_file };
}
