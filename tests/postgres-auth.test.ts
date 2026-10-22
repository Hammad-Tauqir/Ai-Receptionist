import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import type { Pool } from "pg";

test("PostgreSQL keeps auth and access tables in a private schema", async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  (globalThis as typeof globalThis & { novaPgPool?: Pool }).novaPgPool = pool as unknown as Pool;
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-long-enough-for-postgres-tests";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.OWNER_EMAIL = "owner@example.test";

  // pg-mem does not implement the PostgreSQL catalog introspection used by
  // Better Auth's migrator, so seed its documented core tables for runtime tests.
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

  const { auth } = await import("../src/lib/auth");
  const { migrateCustomTables, dbOne, table } = await import("../src/lib/database");
  await migrateCustomTables();
  assert.equal(table("user"), '"nova_auth"."user"');
  assert.ok(await dbOne(`SELECT 1 FROM ${table("allowed_email")} LIMIT 1`) === undefined);
  assert.ok(await dbOne(`SELECT 1 FROM ${table("chat_rate_limit")} LIMIT 1`) === undefined);
  await auth.api.signUpEmail({ body: { name: "Owner", email: "owner@example.test", password: "owner-test-password-strong" } });
  assert.ok(await dbOne(`SELECT 1 FROM ${table("user")} WHERE email = ?`, ["owner@example.test"]));
  const { isApproved } = await import("../src/lib/access");
  const { acceptInvitation, inviteOrApprove, revokeEmailAndInvitations } = await import("../src/lib/invitations");
  const invitation = await inviteOrApprove("guest@example.test", "owner@example.test");
  assert.equal(invitation.kind, "invited");
  if (invitation.kind !== "invited") throw new Error("unexpected_invitation_result");
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get("token");
  assert.ok(token);
  assert.equal(await isApproved("guest@example.test"), false);
  await acceptInvitation(token, "Guest", "guest-test-password-strong");
  assert.equal(await isApproved("guest@example.test"), true);
  const signedIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ email: "guest@example.test", password: "guest-test-password-strong" }),
  }));
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const { currentUser } = await import("../src/lib/auth");
  assert.equal((await currentUser(new Headers({ cookie })))?.email, "guest@example.test");
  const { checkChatRate } = await import("../src/lib/rate-limit");
  for (let index = 0; index < 8; index++) assert.deepEqual(await checkChatRate("guest-id", 1_000), { allowed: true });
  assert.equal((await checkChatRate("guest-id", 1_000)).allowed, false);
  assert.deepEqual(await checkChatRate("guest-id", 61_000), { allowed: true });
  await revokeEmailAndInvitations("guest@example.test");
  assert.equal(await currentUser(new Headers({ cookie })), null);
  await pool.end();
});
