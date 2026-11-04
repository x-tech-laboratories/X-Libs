// The `hash-password` command: adds a user to the accounts file, or changes their password. Asks for the password at a
// terminal, or reads it from stdin, so it never lands in argv or shell history.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { text } from "node:stream/consumers";

import { account_name_pattern, hash_password, set_account } from "./passwords.ts";

// ── Asking ───────────────────────────────────────────────────────────────────

// Reads one line without echoing it.
function ask_hidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(question);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    let answer = "";
    const on_data = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", on_data);
          process.stderr.write("\n");
          resolve(answer);
          return;
        }
        if (character === "\u0003") process.exit(130);
        if (character === "\u007f") answer = answer.slice(0, -1);
        else answer += character;
      }
    };
    process.stdin.on("data", on_data);
    process.stdin.resume();
  });
}

async function read_password(): Promise<string> {
  if (!process.stdin.isTTY) return (await text(process.stdin)).replace(/\r?\n$/, "");
  const password = await ask_hidden("Password: ");
  if (password !== (await ask_hidden("Again: "))) {
    console.error("The passwords differ.");
    process.exit(1);
  }
  return password;
}

// ── Command ──────────────────────────────────────────────────────────────────

// Runs the command with `<name> [file]` from argv; `variable` is the environment variable the app reads the file from.
export async function hash_password_command(variable: string, argv: string[] = process.argv.slice(2)): Promise<void> {
  const name = argv[0] ?? "";
  const file_path = argv[1] ?? "password.hash";
  if (!account_name_pattern.test(name)) {
    console.error("Usage: npm run hash-password -- <name> [file], the name of lowercase letters, digits, '.', '_' and '-'.");
    process.exit(1);
  }

  const password = await read_password();
  if (!password) {
    console.error("The password is empty.");
    process.exit(1);
  }

  const existing = existsSync(file_path) ? readFileSync(file_path, "utf8") : "";
  writeFileSync(file_path, set_account(existing, name, hash_password(password)), { mode: 0o600 });
  console.error(`Set ${name}'s password in ${file_path}; point ${variable} at it.`);
}
