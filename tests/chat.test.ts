import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MESSAGE_LENGTH, validateChatInput } from "../src/lib/chat-contract";
import { ChatError, parseN8nReply, readLimitedBody, sendToN8n, toN8nPayload } from "../src/lib/n8n";
import { createChatHandler } from "../src/app/api/chat/route";
import { createAdminHandlers } from "../src/app/api/admin/allowed-users/route";
import { isN8nConfigured } from "../src/lib/n8n-config";
import { clientIp, createRateLimiter } from "../src/lib/rate-limit";

const input = { message: "Tell me about websites", sessionId: "e4527328-b830-4d56-bdaf-e1aedeb039b1" };
const credentials = { username: "test-user", password: "test-password" };
const mockFetch = (handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) => handler as typeof fetch;
let userSequence = 0;
function approvedChat(send = sendToN8n) {
  const id = `approved-${++userSequence}`;
  return createChatHandler({ authorize: async () => ({ id, email: "approved@example.com", name: "Approved", owner: false }), send });
}
test("validation rejects invalid types, empty/oversize messages and non-v4 IDs", () => {
  for (const invalid of [null, [], "hello", {}, { ...input, message: 7 }, { ...input, message: " " }, { ...input, message: "a".repeat(MAX_MESSAGE_LENGTH + 1) }, { ...input, sessionId: "not-an-id" }]) assert.equal(validateChatInput(invalid), null);
  assert.ok(validateChatInput({ ...input, message: "a".repeat(MAX_MESSAGE_LENGTH) }));
  assert.deepEqual(validateChatInput({ ...input, message: "  hello  " }), { ...input, message: "hello" });
  assert.ok(validateChatInput({ ...input, message: "مجھے ویب سائٹ چاہیے" }));
});
test("client IP selection handles proxy headers and ignores malformed values", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "198.51.100.10, 203.0.113.20" })), "203.0.113.20");
  assert.equal(clientIp(new Headers({ "x-real-ip": "192.0.2.3", "x-forwarded-for": "203.0.113.20" })), "192.0.2.3");
  assert.equal(clientIp(new Headers({ "cf-connecting-ip": "2001:db8::1" })), "2001:db8::1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" })), "unknown");
});
test("per-user and overall limits block excess requests and reset after a minute", () => {
  const limit = createRateLimiter(60_000, 2, 3);
  assert.deepEqual(limit.check("192.0.2.1", 1_000), { allowed: true });
  assert.deepEqual(limit.check("192.0.2.1", 1_000), { allowed: true });
  assert.deepEqual(limit.check("192.0.2.1", 1_000), { allowed: false, retryAfterSeconds: 60 });
  assert.deepEqual(limit.check("192.0.2.2", 1_000), { allowed: true });
  assert.deepEqual(limit.check("192.0.2.3", 1_000), { allowed: false, retryAfterSeconds: 60 });
  assert.deepEqual(limit.check("192.0.2.1", 61_000), { allowed: true });
});
test("standard payload retains stable session ID", () => {
  assert.deepEqual(toN8nPayload(input), { action: "sendMessage", sessionId: input.sessionId, chatInput: input.message });
});
test("last-node reply shapes normalize to text and reject ambiguous/error data", () => {
  assert.equal(parseN8nReply({ output: " Hello " }), "Hello");
  assert.equal(parseN8nReply({ text: "Chain reply" }), "Chain reply");
  assert.equal(parseN8nReply([{ output: "Agent reply" }]), "Agent reply");
  assert.equal(parseN8nReply([{ text: "Chain reply" }]), "Chain reply");
  for (const data of ["hello", null, [], [{ output: "one" }, { output: "two" }], { error: "private detail", output: "bad" }, { message: "private detail" }, { output: " " }, { output: 2 }, { output: "a".repeat(32001) }]) assert.throws(() => parseN8nReply(data), ChatError);
});
test("missing endpoint makes zero network calls", async () => {
  let calls = 0;
  await assert.rejects(sendToN8n(input, { fetchImpl: mockFetch(async () => { calls++; return Response.json({ output: "no" }); }) }), { code: "not_connected" });
  assert.equal(calls, 0);
});
test("adapter sends Basic auth with exact credentials and never follows redirects", async () => {
  for (const password of ["test-password", " leading:pass$#word trailing ", "اردو-password"]) {
    const reply = await sendToN8n(input, { url: "https://example.invalid/chat", username: credentials.username, password, fetchImpl: mockFetch(async (_url, init) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      assert.ok(authorization.startsWith("Basic "));
      assert.equal(Buffer.from(authorization.slice(6), "base64").toString("utf8"), `${credentials.username}:${password}`);
      assert.deepEqual(JSON.parse(init?.body as string), toN8nPayload(input));
      assert.equal(init?.redirect, "error");
      return Response.json({ output: "Mock reply" });
    }) });
    assert.equal(reply, "Mock reply");
  }
});
test("quota, backend and malformed responses are never retried", async () => {
  for (const [response, code] of [[new Response("", { status: 429 }), "rate_limited"], [new Response("", { status: 402 }), "rate_limited"], [new Response("", { status: 500 }), "upstream_error"], [new Response("not JSON"), "invalid_response"], [Response.json({ other: "wrong" }), "invalid_response"]] as const) {
    let calls = 0;
    await assert.rejects(sendToN8n(input, { ...credentials, url: "https://example.invalid/chat", fetchImpl: mockFetch(async () => { calls++; return response; }) }), { code });
    assert.equal(calls, 1);
  }
});
test("unreachable and timeout outcomes are uncertain, with one attempt", async () => {
  let calls = 0;
  await assert.rejects(sendToN8n(input, { ...credentials, url: "https://example.invalid/chat", fetchImpl: mockFetch(async () => { calls++; throw new Error("private detail"); }) }), { code: "unreachable" });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(sendToN8n(input, { ...credentials, url: "https://example.invalid/chat", timeoutMs: 5, fetchImpl: mockFetch(async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  }) }), { code: "timeout" });
  assert.equal(calls, 1);
});
test("configuration requires URL and both valid credentials, with no unauthenticated call", async () => {
  for (const configuration of [
    { url: "https://example.invalid/chat" },
    { url: "https://example.invalid/chat", username: "test-user" },
    { url: "https://example.invalid/chat", password: "test-password" },
    { url: "https://example.invalid/chat", username: " ", password: "test-password" },
  ]) {
    assert.equal(isN8nConfigured(configuration), false);
    let calls = 0;
    await assert.rejects(sendToN8n(input, { ...configuration, fetchImpl: mockFetch(async () => { calls++; throw new Error(); }) }), { code: "not_connected" });
    assert.equal(calls, 0);
  }
  assert.equal(isN8nConfigured({ ...credentials, url: "https://example.invalid/chat" }), true);
  for (const configuration of [
    { ...credentials, url: "http://example.invalid/chat" },
    { ...credentials, url: "invalid" },
    { ...credentials, url: "https://example.invalid/chat", username: "invalid:user" },
  ]) {
    assert.equal(isN8nConfigured(configuration), false);
    await assert.rejects(sendToN8n(input, configuration), { code: "configuration" });
  }
});
test("authentication failures are sanitized and never retried", async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    await assert.rejects(sendToN8n(input, { ...credentials, url: "https://example.invalid/chat", fetchImpl: mockFetch(async () => {
      calls++;
      return new Response("sensitive upstream error", { status });
    }) }), (error: unknown) => {
      assert.ok(error instanceof ChatError);
      assert.equal(error.code, "authentication");
      assert.equal(error.status, 502);
      assert.ok(error.message.includes(`HTTP ${status}`));
      assert.ok(!error.message.includes("sensitive upstream error"));
      assert.ok(!error.message.includes(credentials.password));
      return true;
    });
    assert.equal(calls, 1);
  }
});
test("bounded body reader rejects oversized upstream or request bodies", async () => {
  await assert.rejects(readLimitedBody(new Response("a".repeat(100)).body, 10));
});
test("API rejects invalid inputs before calling any backend", async () => {
  const POST = approvedChat();
  assert.equal((await POST(new Request("http://localhost/api/chat", { method: "POST", body: "hello" }))).status, 415);
  assert.equal((await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, sessionId: "invalid" }) }))).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json", origin: "https://other.invalid" }, body: JSON.stringify(input) }))).status, 403);
});
test("API accepts the public Host when Next uses a different internal hostname", async () => {
  const POST = approvedChat();
  const previous = process.env.N8N_CHAT_URL;
  process.env.N8N_CHAT_URL = "";
  try {
    const response = await POST(new Request("http://localhost:3100/api/chat", { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }, body: JSON.stringify(input) }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "not_connected");
  } finally {
    if (previous === undefined) delete process.env.N8N_CHAT_URL;
    else process.env.N8N_CHAT_URL = previous;
  }
});
test("API rejects an oversized message with a friendly 413 before contacting n8n", async () => {
  const POST = approvedChat();
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.101" },
    body: JSON.stringify({ ...input, message: "a".repeat(MAX_MESSAGE_LENGTH + 1) }),
  }));
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.code, "message_too_long");
  assert.ok(body.error.includes(MAX_MESSAGE_LENGTH.toLocaleString("en-US")));
});
test("API rate limit returns 429 and Retry-After without sending to n8n", async () => {
  const POST = approvedChat();
  const previous = process.env.N8N_CHAT_URL;
  process.env.N8N_CHAT_URL = "";
  try {
    let response: Response | undefined;
    for (let index = 0; index < 9; index++) {
      response = await POST(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.102" },
        body: JSON.stringify(input),
      }));
      if (index < 8) assert.equal(response.status, 503);
    }
    assert.equal(response?.status, 429);
    assert.ok(Number(response?.headers.get("Retry-After")) > 0);
    const body = await response?.json();
    assert.equal(body.code, "rate_limited");
    assert.ok(body.error.includes("not sent"));
  } finally {
    if (previous === undefined) delete process.env.N8N_CHAT_URL;
    else process.env.N8N_CHAT_URL = previous;
  }
});

test("unauthenticated and unapproved visitors are blocked before external services", async () => {
  let calls = 0;
  const POST = createChatHandler({ authorize: async () => null, send: async () => { calls++; return "never"; } });
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "unauthorized");
  assert.equal(calls, 0);
});

test("an approved user can chat through a mocked external service", async () => {
  let calls = 0;
  const POST = approvedChat(async value => { calls++; assert.deepEqual(value, input); return "Mocked welcome"; });
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "Mocked welcome" });
  assert.equal(calls, 1);
});

test("revocation blocks the very next chat request despite the same session", async () => {
  let approved = true; let calls = 0;
  const POST = createChatHandler({ authorize: async () => approved ? ({ id: "revoked-user", email: "person@example.com", name: "Person", owner: false }) : null, send: async () => { calls++; return "ok"; } });
  const request = () => new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal((await POST(request())).status, 200);
  approved = false;
  assert.equal((await POST(request())).status, 401);
  assert.equal(calls, 1);
});

test("only the owner can view and change the allowlist", async () => {
  const rows = [{ email: "owner@example.com", addedAt: 0, addedBy: "environment", owner: true }];
  const dependencies = {
    list: async () => rows,
    listPending: async () => [],
    invite: async (email: string, addedBy: string) => ({ kind: "approved" as const, user: { email, addedAt: 1, addedBy, owner: false } }),
    revoke: async () => true,
  };
  const regular = createAdminHandlers({ ...dependencies, authorize: async () => ({ id: "user", email: "user@example.com", name: "User", owner: false }) });
  assert.equal((await regular.GET(new Request("http://localhost/api/admin/allowed-users"))).status, 403);
  assert.equal((await regular.POST(new Request("http://localhost/api/admin/allowed-users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "new@example.com" }) }))).status, 403);
  const owner = createAdminHandlers({ ...dependencies, authorize: async () => ({ id: "owner", email: "owner@example.com", name: "Owner", owner: true }) });
  assert.equal((await owner.GET(new Request("http://localhost/api/admin/allowed-users"))).status, 200);
  assert.equal((await owner.POST(new Request("http://localhost/api/admin/allowed-users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "new@example.com" }) }))).status, 201);
  assert.equal((await owner.DELETE(new Request("http://localhost/api/admin/allowed-users", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "new@example.com" }) }))).status, 200);
});
