import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { make_key } from "../test_keys.ts";
import { generateKeyPairSync } from "node:crypto";
import {
  agent_hello_text, fingerprint_of, generate_agent_key, is_nonce, key_fingerprint, new_nonce, parse_private_key, parse_public_key, parse_server_keys, public_key_line,
  public_line_of_private_text, server_challenge_text, server_message_text, sign_challenge, sign_text, signed_bytes, verify_challenge, verify_text,
} from "../../src/agent/keys.ts";

let folder: string;

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "x-libs-keys-"));
});

describe("agent keys", () => {
  it("reads a key ssh-keygen made and signs a challenge its public line verifies", () => {
    const { private_file, public_line } = make_key(folder, "odin");
    const private_key = parse_private_key(readFileSync(private_file, "utf8"));
    const public_key = parse_public_key(public_line);

    const signature = sign_challenge(private_key, "x-test", "odin", "nonce-1");

    expect(verify_challenge(public_key, "x-test", "odin", "nonce-1", signature)).toBe(true);
    expect(verify_challenge(public_key, "x-test", "odin", "nonce-2", signature)).toBe(false);
    expect(verify_challenge(public_key, "x-test", "thor", "nonce-1", signature)).toBe(false);
    expect(verify_challenge(public_key, "x-other", "odin", "nonce-1", signature)).toBe(false);
    expect(verify_challenge(public_key, "x-test", "odin", "nonce-1", "not a signature")).toBe(false);
  });

  it("refuses another key's signature", () => {
    const first = make_key(folder, "first");
    const second = make_key(folder, "second");

    const signature = sign_challenge(parse_private_key(readFileSync(first.private_file, "utf8")), "x-test", "odin", "nonce");

    expect(verify_challenge(parse_public_key(second.public_line), "x-test", "odin", "nonce", signature)).toBe(false);
  });

  it("gives the fingerprint ssh-keygen prints", () => {
    const { private_file, public_line } = make_key(folder, "fingerprint");

    const printed = execFileSync("ssh-keygen", ["-l", "-f", `${private_file}.pub`], { encoding: "utf8" }).split(" ")[1];

    expect(key_fingerprint(public_line)).toBe(printed);
  });

  it("refuses an encrypted private key without quoting it", () => {
    const { private_file } = make_key(folder, "encrypted", ["-N", "a test passphrase"]);
    const text = readFileSync(private_file, "utf8");

    expect(() => parse_private_key(text)).toThrow(/encrypted with a passphrase/);
    try {
      parse_private_key(text);
    } catch (error) {
      expect((error as Error).message).not.toContain(text.split("\n")[1]);
    }
  });

  it("refuses text that is no OpenSSH private key", () => {
    expect(() => parse_private_key("hello")).toThrow(/not an OpenSSH private key/);
  });

  it("refuses a bad or non-ed25519 public line", () => {
    const { public_line } = make_key(folder, "line");
    const blob = public_line.split(" ")[1];

    expect(() => parse_public_key("")).toThrow(/OpenSSH public key line/);
    expect(() => parse_public_key("ssh-ed25519")).toThrow(/OpenSSH public key line/);
    expect(() => parse_public_key(`ssh-rsa ${blob}`)).toThrow(/must be an ssh-ed25519 key, not ssh-rsa/);
    expect(() => parse_public_key("ssh-ed25519 not*base64")).toThrow(/not base64/);
    expect(() => parse_public_key(`ssh-ed25519 ${blob.slice(0, 20)}`)).toThrow(/cut short|wrong length/);
    expect(() => parse_public_key(`ssh-ed25519 ${blob} a comment with spaces`)).not.toThrow();
  });

  it("makes a key ssh-keygen reads, whose signature its public line verifies", () => {
    const { private_text, public_line } = generate_agent_key("x-libs-test");
    const private_file = join(folder, "generated");
    writeFileSync(private_file, private_text, { mode: 0o600 });

    const derived = execFileSync("ssh-keygen", ["-y", "-f", private_file], { encoding: "utf8" }).trim();
    const signature = sign_challenge(parse_private_key(private_text), "x-test", "odin", "nonce");

    expect(public_line.startsWith(derived)).toBe(true);
    expect(verify_challenge(parse_public_key(public_line), "x-test", "odin", "nonce", signature)).toBe(true);
  });
});

describe("server key", () => {
  it("prints the public line and fingerprint ssh-keygen gives for the private key file", () => {
    const { private_file, public_line } = make_key(folder, "server");
    const private_text = readFileSync(private_file, "utf8");
    // ssh-keygen -y adds the key's comment, which the key alone does not carry.
    const derived = execFileSync("ssh-keygen", ["-y", "-f", private_file], { encoding: "utf8" }).trim().split(" ").slice(0, 2).join(" ");
    const printed = execFileSync("ssh-keygen", ["-l", "-f", `${private_file}.pub`], { encoding: "utf8" }).split(" ")[1];

    expect(public_line_of_private_text(private_text)).toBe(derived);
    expect(public_line_of_private_text(private_text, "x-test-server")).toBe(`${derived} x-test-server`);
    expect(public_key_line(parse_public_key(public_line))).toBe(derived);
    expect(fingerprint_of(parse_private_key(private_text))).toBe(printed);
    expect(fingerprint_of(parse_public_key(public_line))).toBe(key_fingerprint(public_line));
  });

  it("refuses a key that is not ed25519", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

    expect(() => fingerprint_of(publicKey)).toThrow(/must be an ed25519 key, not ec/);
  });

  it("encodes each signed part as a netstring of its UTF-8 bytes", () => {
    expect(signed_bytes(["ab", "", "é|"]).toString("utf8")).toBe("2:ab,0:,3:é|,");
    expect(server_message_text("x-test", "odin", "n1", "n2", 7, '{"type":"ping"}').toString("utf8"))
      .toBe('23:agent-server-message-v1,6:x-test,4:odin,2:n1,2:n2,1:7,15:{"type":"ping"},');
    expect(server_challenge_text("x-test", "odin", "n1", "SHA256:f").toString("utf8")).toBe("25:agent-server-challenge-v1,6:x-test,4:odin,2:n1,8:SHA256:f,");
    expect(agent_hello_text("x-test", "odin", "n1", "n2", "SHA256:f").toString("utf8")).toBe("14:agent-hello-v2,6:x-test,4:odin,2:n1,2:n2,8:SHA256:f,");
    expect(signed_bytes(["a|b", "c"]).equals(signed_bytes(["a", "b|c"]))).toBe(false);
  });

  it("signs a text only the matching key verifies", () => {
    const first = parse_private_key(readFileSync(make_key(folder, "signer").private_file, "utf8"));
    const second = make_key(folder, "not-signer");
    const text = server_message_text("x-test", "odin", "n1", "n2", 1, "{}");
    const signature = sign_text(first, text);

    expect(verify_text(first, text, signature)).toBe(true);
    expect(verify_text(first, server_message_text("x-test", "odin", "n1", "n2", 2, "{}"), signature)).toBe(false);
    expect(verify_text(parse_public_key(second.public_line), text, signature)).toBe(false);
    expect(verify_text(first, text, 42)).toBe(false);
    expect(verify_text(first, text, "not base64 at all")).toBe(false);
  });

  it("reads the accepted server keys by fingerprint and makes nonces of the expected shape", () => {
    const one = make_key(folder, "accepted-one");
    const two = make_key(folder, "accepted-two");

    const keys = parse_server_keys([one.public_line, two.public_line, one.public_line]);

    expect([...keys.keys()]).toEqual([key_fingerprint(one.public_line), key_fingerprint(two.public_line)]);
    expect(() => parse_server_keys(["ssh-rsa AAAA"])).toThrow(/ssh-ed25519/);
    expect(is_nonce(new_nonce())).toBe(true);
    expect(new_nonce()).not.toBe(new_nonce());
    expect(is_nonce("short")).toBe(false);
    expect(is_nonce("a".repeat(129))).toBe(false);
    expect(is_nonce(`${"a".repeat(20)}|`)).toBe(false);
    expect(is_nonce(7)).toBe(false);
  });
});
