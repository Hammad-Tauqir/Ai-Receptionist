import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "better-auth/crypto";
import { newDb } from "pg-mem";
import type { Pool } from "pg";

test("SQLite password accounts and approvals can be imported into an empty PostgreSQL schema", async () => {
  const sourcePath = path.resolve("data", `import-test-${randomUUID()}.db`);
  const source = new Database(sourcePath);
  source.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER, image TEXT, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE "account" (id TEXT PRIMARY KEY, accountId TEXT, providerId TEXT, userId TEXT, password TEXT, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE allowed_email (email TEXT PRIMARY KEY, added_at INTEGER, added_by TEXT);
  `);
  const date = "2026-01-01T00:00:00.000Z";
  const password = "owner-import-test-password";
  const passwordHash = await hashPassword(password);
  source.prepare('INSERT INTO "user" VALUES (?, ?, ?, ?, ?, ?, ?)').run("owner-id", "Owner", "owner@example.test", 0, null, date, date);
  source.prepare('INSERT INTO "account" VALUES (?, ?, ?, ?, ?, ?, ?)').run("account-id", "owner-id", "credential", "owner-id", passwordHash, date, date);
  source.prepare('INSERT INTO allowed_email VALUES (?, ?, ?)').run("guest@example.test", 1_000, "owner@example.test");
  source.close();

  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  (globalThis as typeof globalThis & { novaPgPool?: Pool }).novaPgPool = pool as unknown as Pool;
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-long-enough-for-import-tests";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.OWNER_EMAIL = "owner@example.test";
  try {
    await pool.query("CREATE SCHEMA nova_auth");
    await pool.query(`CREATE TABLE nova_auth."user" (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL, image TEXT,
      "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL
    )`);
    await pool.query(`CREATE TABLE nova_auth."session" (
      id TEXT PRIMARY KEY, "expiresAt" TIMESTAMP NOT NULL, token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL,
      "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL REFERENCES nova_auth."user"(id)
    )`);
    await pool.query(`CREATE TABLE nova_auth."account" (
      id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES nova_auth."user"(id),
      "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMP, "refreshTokenExpiresAt" TIMESTAMP,
      scope TEXT, password TEXT, "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL
    )`);
    await pool.query(`CREATE TABLE nova_auth."verification" (
      id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
      "expiresAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL
    )`);
    const { migrateCustomTables, dbOne, table } = await import("../src/lib/database");
    await migrateCustomTables();
    const { importSqliteAccounts } = await import("../scripts/import-sqlite");
    assert.deepEqual(await importSqliteAccounts(sourcePath), { users: 1, approvals: 1 });
    assert.deepEqual(await importSqliteAccounts(sourcePath, true, async () => {}), { users: 1, approvals: 1 });
    assert.ok(await dbOne(`SELECT 1 FROM ${table("allowed_email")} WHERE email = ?`, ["guest@example.test"]));
    const { auth } = await import("../src/lib/auth");
    const signedIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "owner@example.test", password }),
    }));
    assert.equal(signedIn.status, 200);
    await assert.rejects(importSqliteAccounts(sourcePath, true, async () => {}), { message: "target_not_empty" });
  } finally {
    await pool.end();
    unlinkSync(sourcePath);
  }
});
