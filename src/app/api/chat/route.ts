import { MAX_MESSAGE_LENGTH, validateChatInput } from "@/lib/chat-contract";
import { currentUser, type AuthorizedUser } from "@/lib/auth";
import { ChatError, readLimitedBody, sendToN8n } from "@/lib/n8n";
import { getN8nConfig } from "@/lib/n8n-config";
import { checkChatRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

type ChatDependencies = {
  authorize: (headers: Headers) => Promise<AuthorizedUser | null>;
  send: typeof sendToN8n;
};

export function createChatHandler(dependencies: ChatDependencies = { authorize: currentUser, send: sendToN8n }) {
  return async function POST(request: Request) {
  // Same-origin browser requests only; this never forwards browser-supplied credentials.
  const origin = request.headers.get("origin");
  // Next may use an internal hostname in request.url. The HTTP Host retains the
  // visitor-facing host, including its port, behind the Next server.
  const host = request.headers.get("host") ?? new URL(request.url).host;
  let allowedOrigin = !origin;
  try { if (origin) allowedOrigin = new URL(origin).host === host; } catch { allowedOrigin = false; }
  if (!allowedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Request origin not allowed.", code: "invalid_request" }, { status: 403, headers });
  }
  const user = await dependencies.authorize(request.headers);
  if (!user) {
    return Response.json({ error: "Log in with an approved email to use the receptionist.", code: "unauthorized" }, { status: 401, headers });
  }
  let limit;
  try { limit = await checkChatRate(user.id); }
  catch {
    return Response.json({ error: "The receptionist is temporarily unavailable. Please try again later.", code: "unavailable" }, { status: 503, headers });
  }
  if (!limit.allowed) {
    return Response.json({
      error: "You’ve sent several messages recently. Please wait a moment before trying again. Your message was not sent.",
      code: "rate_limited",
    }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) } });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Send a JSON message.", code: "invalid_request" }, { status: 415, headers });
  }
  let body: unknown;
  try { body = JSON.parse(await readLimitedBody(request.body, 32_000)); }
  catch { return Response.json({ error: "The request is invalid or too large.", code: "invalid_request" }, { status: 400, headers }); }
  const message = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).message : undefined;
  const input = validateChatInput(body);
  if (typeof message === "string" && message.trim().length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: `Please shorten your message to ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters or fewer. It was not sent.`, code: "message_too_long" }, { status: 413, headers });
  }
  if (!input) return Response.json({ error: `Enter a message of up to ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters and use a valid conversation ID.`, code: "invalid_request" }, { status: 400, headers });
  try {
    const reply = await dependencies.send(input, getN8nConfig());
    return Response.json({ reply }, { headers });
  } catch (error) {
    // Intentionally never log request bodies, upstream bodies, URLs, or credentials.
    const failure = error instanceof ChatError ? error : new ChatError("unknown", 500, "The action could not be confirmed. Please check before submitting again.");
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers });
  }
  };
}

export const POST = createChatHandler();
