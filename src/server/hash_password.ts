// The `hash-password` command: adds a user to the accounts file, or changes their password. Asks for the password at a
// terminal, or reads it from stdin, so it never lands in argv or shell history.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { text } from "node:stream/consumers";

import password from "@inquirer/password";

import { account_name_pattern, hash_password, set_account } from "./passwords.ts";

// ── Asking ───────────────────────────────────────────────────────────────────

// Asks twice at a terminal without echoing, on stderr so stdout stays clean; reads one line from a pipe.
async function read_password(): Promise<string> {
  if (!process.stdin.isTTY) return (await text(process.stdin)).replace(/\r?\n$/, "");
  const ask = (message: string) => password({ message, mask: false }, { output: process.stderr });
  try {
    const first = await ask("Password:");
    if (first !== (await ask("Again:"))) {
      console.error("The passwords differ.");
      process.exit(1);
    }
    return first;
  } catch (error) {
    // Ctrl-C at the prompt ends the command as a shell would.
    if ((error as Error).name === "ExitPromptError") process.exit(130);
    throw error;
  }
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
