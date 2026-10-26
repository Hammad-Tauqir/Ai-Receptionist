import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";

loadEnvConfig(process.cwd());

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

  const { dbOne, dbExecute, withTransaction, usesPostgres } = await import("../src/lib/database");
  if (!usesPostgres) throw new Error("postgres_required");

  const owner = await dbOne<{ id: string }>('SELECT id FROM "nova_auth"."user" WHERE email = ?', [email]);
  if (!owner) throw new Error("owner_account_missing");
  const account = await dbOne<{ id: string }>(
    'SELECT id FROM "nova_auth"."account" WHERE "userId" = ? AND "providerId" = ?',
    [owner.id, "credential"],
  );
  if (!account) throw new Error("owner_account_missing");

  process.stdout.write(`Reset password for ${email}. Existing sessions will be signed out.\n`);
  const password = await hiddenQuestion("New password (12 to 128 characters): ");
  if (password.length < 12 || password.length > 128) throw new Error("invalid_password_length");
  const confirmation = await hiddenQuestion("Confirm new password: ");
  if (password !== confirmation) throw new Error("password_mismatch");

  // Use Better Auth's maintained password hasher; never store or log plaintext.
  const passwordHash = await hashPassword(password);
  await withTransaction(async transaction => {
    const changed = await dbExecute(
      'UPDATE "nova_auth"."account" SET password = ?, "updatedAt" = NOW() WHERE id = ? AND "userId" = ? AND "providerId" = ?',
      [passwordHash, account.id, owner.id, "credential"], transaction,
    );
    if (changed !== 1) throw new Error("owner_account_missing");
    await dbExecute('DELETE FROM "nova_auth"."session" WHERE "userId" = ?', [owner.id], transaction);
  });
  process.stdout.write("Owner password reset. Log in with the new password.\n");
}

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  const message = code === "interactive_terminal_required" ? "Run this command in your own interactive terminal."
    : code === "owner_email_missing" ? "Set OWNER_EMAIL in .env.local first."
      : code === "postgres_required" ? "Set the Supabase pooler DATABASE_URL in .env.local first."
        : code === "owner_account_missing" ? "Owner password account was not found in the configured database."
          : code === "invalid_password_length" ? "Use a password of 12 to 128 characters."
            : code === "password_mismatch" ? "Passwords did not match. Nothing was changed."
              : code === "cancelled" ? "Password reset cancelled. Nothing was changed."
                : "Password reset failed. Nothing was changed; check the database connection.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
