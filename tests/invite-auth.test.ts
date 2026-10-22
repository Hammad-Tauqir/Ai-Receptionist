import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getMigrations } from "better-auth/db/migration";

test("owner bootstrap, private invitation, password login, and immediate revocation", async () => {
  process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-long-enough-for-integration-tests";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.OWNER_EMAIL = "owner@example.test";
  process.env.AUTH_DATABASE_PATH = path.resolve("data", `invite-test-${randomUUID()}.db`);

  const { auth, authOptions, currentUser } = await import("../src/lib/auth");
  const { isApproved } = await import("../src/lib/access");
  const { revokeEmailAndInvitations, listPendingInvitations } = await import("../src/lib/invitations");
  const { POST: publicSignUp } = await import("../src/app/api/auth/[...all]/route");
  const { createChatHandler } = await import("../src/app/api/chat/route");
  const admin = await import("../src/app/api/admin/allowed-users/route");
  const { POST: acceptInvite } = await import("../src/app/api/invitations/accept/route");
  await (await getMigrations(authOptions)).runMigrations();

  const ownerPassword = "owner-test-password-strong";
  await auth.api.signUpEmail({ body: { name: "Owner", email: "owner@example.test", password: ownerPassword } });
  assert.equal(await isApproved("owner@example.test"), true);
  const publicResponse = await publicSignUp(new Request("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Attacker", email: "target@example.test", password: "attacker-password-strong" }),
  }));
  assert.equal(publicResponse.status, 403);
  assert.equal((await publicSignUp(new Request("http://localhost:3000/api/auth/sign-up/%65mail", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
  }))).status, 403);

  async function signIn(email: string, password: string) {
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email, password }),
    }));
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert.ok(cookie);
    return cookie;
  }
  const ownerCookie = await signIn("owner@example.test", ownerPassword);
  assert.equal((await admin.GET(new Request("http://localhost:3000/api/admin/allowed-users"))).status, 403);
  const ownerHeaders = { "content-type": "application/json", origin: "http://localhost:3000", cookie: ownerCookie };
  const makeInvite = () => admin.POST(new Request("http://localhost:3000/api/admin/allowed-users", {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ email: "target@example.test" }),
  }));
  const crossSite = await admin.POST(new Request("http://localhost:3000/api/admin/allowed-users", {
    method: "POST", headers: { ...ownerHeaders, origin: "https://elsewhere.invalid" }, body: JSON.stringify({ email: "target@example.test" }),
  }));
  assert.equal(crossSite.status, 403);

  const firstResponse = await makeInvite();
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json() as { kind: string; url: string };
  assert.equal(first.kind, "invited");
  assert.equal(await isApproved("target@example.test"), false);
  assert.equal((await listPendingInvitations()).length, 1);
  const firstToken = new URLSearchParams(new URL(first.url).hash.slice(1)).get("token")!;
  const secondResponse = await makeInvite();
  const second = await secondResponse.json() as { kind: string; url: string };
  assert.equal(second.kind, "invited");
  const accept = (token: string) => acceptInvite(new Request("http://localhost:3000/api/invitations/accept", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ token, name: "Recipient", password: "recipient-password-strong" }),
  }));
  assert.equal((await accept(firstToken)).status, 410);

  const token = new URLSearchParams(new URL(second.url).hash.slice(1)).get("token")!;
  assert.equal((await accept(token)).status, 200);
  assert.equal(await isApproved("target@example.test"), true);
  assert.equal((await listPendingInvitations()).length, 0);
  assert.equal((await accept(token)).status, 410);

  const cookie = await signIn("target@example.test", "recipient-password-strong");
  const headers = new Headers({ cookie });
  assert.equal((await currentUser(headers))?.email, "target@example.test");
  assert.equal((await admin.GET(new Request("http://localhost:3000/api/admin/allowed-users", { headers }))).status, 403);
  let upstreamCalls = 0;
  const chat = createChatHandler({ authorize: currentUser, send: async () => { upstreamCalls++; return "Mocked reply"; } });
  const chatRequest = () => new Request("http://localhost:3000/api/chat", {
    method: "POST", headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ message: "Tell me about services", sessionId: "e4527328-b830-4d56-bdaf-e1aedeb039b1" }),
  });
  assert.equal((await chat(chatRequest())).status, 200);
  assert.equal(upstreamCalls, 1);

  const revoke = await admin.DELETE(new Request("http://localhost:3000/api/admin/allowed-users", {
    method: "DELETE", headers: ownerHeaders, body: JSON.stringify({ email: "target@example.test" }),
  }));
  assert.equal(revoke.status, 200);
  assert.equal(await isApproved("target@example.test"), false);
  assert.equal(await currentUser(headers), null);
  assert.equal((await chat(chatRequest())).status, 401);
  assert.equal(upstreamCalls, 1);
  const revokedSignIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ email: "target@example.test", password: "recipient-password-strong" }),
  }));
  assert.notEqual(revokedSignIn.status, 200);
  await assert.rejects(revokeEmailAndInvitations("owner@example.test"), { message: "owner_cannot_be_revoked" });

  const logout = await publicSignUp(new Request("http://localhost:3000/api/auth/sign-out", {
    method: "POST", headers: ownerHeaders, body: "{}",
  }));
  assert.equal(logout.status, 200);
  assert.equal(await currentUser(new Headers({ cookie: ownerCookie })), null);
});
