import { acceptInvitation } from "@/lib/invitations";
import { readLimitedBody } from "@/lib/n8n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  let allowedOrigin = !origin;
  try { if (origin) allowedOrigin = new URL(origin).host === host; } catch { allowedOrigin = false; }
  if (!allowedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Request origin not allowed." }, { status: 403, headers: responseHeaders });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Send JSON." }, { status: 415, headers: responseHeaders });
  }
  let body: unknown;
  try { body = JSON.parse(await readLimitedBody(request.body, 2_048)); }
  catch { return Response.json({ error: "Invalid request." }, { status: 400, headers: responseHeaders }); }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (typeof input.token !== "string" || typeof input.name !== "string" || typeof input.password !== "string") {
    return Response.json({ error: "Complete all fields." }, { status: 400, headers: responseHeaders });
  }
  const name = input.name.trim();
  if (!name || name.length > 80 || input.password.length < 12 || input.password.length > 128) {
    return Response.json({ error: "Enter your name and a password of 12 to 128 characters." }, { status: 400, headers: responseHeaders });
  }
  try {
    await acceptInvitation(input.token, name, input.password);
    return Response.json({ ok: true }, { headers: responseHeaders });
  } catch (error) {
    const known = error instanceof Error && ["invalid_invitation", "account_exists"].includes(error.message);
    return Response.json({ error: known ? "This invite is expired or has already been used. Ask the owner for a new one." : "Account setup failed. Please try again or ask the owner for a new invite." }, { status: known ? 410 : 400, headers: responseHeaders });
  }
}
