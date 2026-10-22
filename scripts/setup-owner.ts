import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { getMigrations } from "better-auth/db/migration";

loadEnvConfig(process.cwd());

function ensureLocalSetting(key: "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL", value: string) {
  if (process.env[key]?.trim()) return;
  const envPath = path.join(process.cwd(), ".env.local");
  const contents = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const emptySetting = new RegExp(`^${key}=[ \\t]*\\r?$`, "m");
  if (emptySetting.test(contents)) {
    writeFileSync(envPath, contents.replace(emptySetting, `${key}=${value}`), { encoding: "utf8", mode: 0o600 });
  } else if (new RegExp(`^${key}=`, "m").test(contents)) {
    throw new Error("invalid_auth_config");
  } else {
    appendFileSync(envPath, `\n${key}=${value}\n`, { encoding: "utf8", mode: 0o600 });
  }
  process.env[key] = value;
}

function hiddenQuestion(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || !input.setRawMode) {
      reject(new Error("interactive_terminal_required"));
      return;
    }
    let value = "";
    process.stdout.write(prompt);
    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u0003") { finish(new Error("cancelled")); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " " && value.length < 128) value += character;
      }
    };
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  });
}

async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("owner_email_missing");
  ensureLocalSetting("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
  ensureLocalSetting("BETTER_AUTH_URL", "http://localhost:3000");

  const { auth, authOptions } = await import("../src/lib/auth");
  const { database } = await import("../src/lib/database");
  await (await getMigrations(authOptions)).runMigrations();
  if (database.prepare("SELECT 1 FROM user WHERE email = ?").get(email)) {
    process.stdout.write("Owner account already exists. No password was changed.\n");
    return;
  }

  process.stdout.write(`Create the owner account for ${email}. Password input is hidden.\n`);
  const password = await hiddenQuestion("Password (12 to 128 characters): ");
  if (password.length < 12 || password.length > 128) throw new Error("invalid_password_length");
  const confirmation = await hiddenQuestion("Confirm password: ");
  if (password !== confirmation) throw new Error("password_mismatch");
  await auth.api.signUpEmail({ body: { name: "Owner", email, password } });
  process.stdout.write("Owner account created. Start the site and log in at /login.\n");
}

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  const message = code === "interactive_terminal_required" ? "Run this command in an interactive terminal."
    : code === "owner_email_missing" ? "Set OWNER_EMAIL in .env.local first."
      : code === "invalid_auth_config" ? "Check the authentication settings in .env.local. No account was created."
      : code === "invalid_password_length" ? "Use a password of 12 to 128 characters."
        : code === "password_mismatch" ? "Passwords did not match. No account was created."
          : code === "cancelled" ? "Owner setup cancelled."
            : "Owner setup failed. Check the local database and try again.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
