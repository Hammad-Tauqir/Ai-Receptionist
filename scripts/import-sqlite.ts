import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import { getMigrations } from "better-auth/db/migration";

loadEnvConfig(process.cwd());

type UserRow = {
  id: string; name: string; email: string; emailVerified: number;
  image: string | null; createdAt: string | number; updatedAt: string | number;
};
type AccountRow = {
  id: string; accountId: string; providerId: string; userId: string;
  password: string | null; createdAt: string | number; updatedAt: string | number;
};
type AllowedRow = { email: string; added_at: number; added_by: string };

function dateValue(value: string | number): Date {
  const date = new Date(typeof value === "string" && /^\d{10,13}$/.test(value) ? Number(value) : value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_local_date");
  return date;
}

export async function importSqliteAccounts(sourcePath: string, apply = false, prepareTarget?: () => Promise<void>): Promise<{ users: number; approvals: number }> {
  if (!existsSync(sourcePath)) throw new Error("local_database_missing");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let users: UserRow[];
  let accounts: AccountRow[];
  let approvals: AllowedRow[];
  try {
    ({ users, accounts, approvals } = source.transaction(() => ({
      users: source.prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user"').all() as UserRow[],
      accounts: source.prepare('SELECT id, accountId, providerId, userId, password, createdAt, updatedAt FROM "account"').all() as AccountRow[],
      approvals: source.prepare('SELECT email, added_at, added_by FROM allowed_email').all() as AllowedRow[],
    }))());
  } finally { source.close(); }

  // Only the current email/password login method can be migrated safely here.
  if (accounts.some(row => row.providerId !== "credential" || !row.password) ||
      users.some(user => accounts.filter(account => account.userId === user.id).length !== 1)) {
    throw new Error("unsupported_local_accounts");
  }
  for (const user of users) { dateValue(user.createdAt); dateValue(user.updatedAt); }
  for (const account of accounts) { dateValue(account.createdAt); dateValue(account.updatedAt); }
  const counts = { users: users.length, approvals: approvals.length };
  if (!apply) return counts;

  const { usesPostgres, dbExecute, dbOne, migrateCustomTables, table, withTransaction } = await import("../src/lib/database");
  if (!usesPostgres) throw new Error("database_url_missing");
  if (prepareTarget) await prepareTarget();
  else {
    const { authOptions } = await import("../src/lib/auth");
    await (await getMigrations(authOptions)).runMigrations();
    await migrateCustomTables();
  }

  await withTransaction(async transaction => {
    for (const name of ["user", "account", "session", "verification", "allowed_email", "invitation"] as const) {
      const target = name === "account" || name === "session" || name === "verification" ? `"nova_auth"."${name}"` : table(name);
      const row = await dbOne<{ count: number | string }>(`SELECT COUNT(*) AS count FROM ${target}`, [], transaction);
      if (Number(row?.count) !== 0) throw new Error("target_not_empty");
    }
    for (const user of users) {
      await dbExecute(`INSERT INTO ${table("user")} (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [user.id, user.name, user.email, Boolean(user.emailVerified), user.image, dateValue(user.createdAt), dateValue(user.updatedAt)], transaction);
    }
    for (const account of accounts) {
      await dbExecute(`INSERT INTO "nova_auth"."account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [account.id, account.accountId, account.providerId, account.userId, account.password, dateValue(account.createdAt), dateValue(account.updatedAt)], transaction);
    }
    for (const approval of approvals) {
      await dbExecute(`INSERT INTO ${table("allowed_email")} (email, added_at, added_by) VALUES (?, ?, ?)`, [approval.email, approval.added_at, approval.added_by], transaction);
    }
  });
  return counts;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sourcePath = path.resolve(process.env.AUTH_DATABASE_PATH || "data/auth.db");
  const counts = await importSqliteAccounts(sourcePath, apply);
  process.stdout.write(apply
    ? `Imported ${counts.users} password accounts and ${counts.approvals} approvals. Existing sessions and pending links were not imported.\n`
    : `Ready to import ${counts.users} password accounts and ${counts.approvals} approvals. No remote changes made; rerun with --apply after setting DATABASE_URL.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    const code = error instanceof Error ? error.message : "";
    const message = code === "local_database_missing" ? "The local SQLite database was not found."
      : code === "unsupported_local_accounts" ? "The local database contains unsupported accounts; nothing was imported."
        : code === "database_url_missing" || code === "database_url_invalid" ? "Set a valid server-side DATABASE_URL first."
          : code === "target_not_empty" ? "The PostgreSQL auth database is not empty; nothing was imported."
            : "Import failed. Check database connectivity and schema; no credentials were printed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
