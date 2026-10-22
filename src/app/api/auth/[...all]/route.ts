import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = toNextJsHandler(auth);
export const GET = handler.GET;
export function POST(request: Request) {
  // Only login and logout are public HTTP actions. Registration is invoked
  // solely from the checked invitation route or local owner setup command.
  let pathname = "";
  try { pathname = decodeURIComponent(new URL(request.url).pathname).replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase(); }
  catch { /* malformed paths are denied below */ }
  if (pathname !== "/api/auth/sign-in/email" && pathname !== "/api/auth/sign-out") {
    return Response.json({ error: "An invitation is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return handler.POST(request);
}
